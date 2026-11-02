import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { WebError } from '@deepseek-ai/dsh-web';
import { fail, record, finite } from './http.mjs';

const emptyCounters = () => ({ requests: 0, successes: 0, errors: 0, tavilyCredits: 0, confirmedCredits: 0, estimatedUsd: 0, costReportedRequests: 0, uncertain: 0 });
const initial = () => ({ version: 1, months: {}, days: {} });
const budgetError = message => fail(message, 'WEB_BUDGET_EXHAUSTED');

/** Only counters and credential digests are persisted; never keys, queries or source text. */
export class UsageLedger {
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.data = initial();
    this.turns = new Map();
    this.tail = Promise.resolve();
    this.ready = this.load();
    // A loader that has not awaited its first operation must not create an unhandled rejection.
    this.ready.catch(() => {});
  }

  async load() {
    if (!this.file) return;
    let source;
    try { source = await readFile(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw fail('Search usage could not be read.', 'WEB_USAGE_STORAGE_ERROR'); }
    try {
      const value = JSON.parse(source);
      if (value.version !== 1 || !record(value.months) || !record(value.days)) throw new Error();
      for (const month of Object.values(value.months)) {
        if (!record(month)) throw new Error();
        for (const counters of Object.values(month)) {
          if (!record(counters) || Object.keys(emptyCounters()).some(key => !finite(counters[key]))) throw new Error();
        }
      }
      if (Object.values(value.days).some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error();
      this.data = value;
    } catch { throw fail('Search usage file is invalid. Restore it before searching.', 'WEB_USAGE_STORAGE_ERROR'); }
  }

  exclusive(operation) {
    const result = this.tail.then(async () => {
      await this.ready;
      if (!this.file) return operation();
      try {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        return await withFileLock(this.file, async () => { await this.load(); return operation(); });
      } catch (error) {
        if (error instanceof WebError) throw error;
        throw fail('Search usage could not be locked or saved.', 'WEB_USAGE_STORAGE_ERROR');
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }

  async persist() {
    if (!this.file) return;
    try {
      await writeFileAtomic(this.file, JSON.stringify(this.data), { mode: 0o600, dirMode: 0o700 });
    } catch { throw fail('Search usage could not be saved; no new request was sent.', 'WEB_USAGE_STORAGE_ERROR'); }
  }

  period() {
    const date = new Date(this.now());
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return { month, day: `${month}-${String(date.getDate()).padStart(2, '0')}` };
  }

  /** Reserve the complete fan-out atomically before sending any of it. */
  reserve(plans, options, turnKey) {
    return this.exclusive(async () => {
      const { month, day } = this.period();
      const turn = this.turns.get(turnKey) ?? { requests: 0, tavilyCredits: 0 };
      const credits = plans.reduce((sum, plan) => sum + plan.credits, 0);
      if (turn.requests + plans.length > options.turnMaxRequests || turn.tavilyCredits + credits > options.turnMaxTavilyCredits) {
        throw budgetError('This turn has reached its search budget. Answer using the sources already retrieved; do not repeat the search.');
      }
      if (options.dailyMaxRequests && (this.data.days[day] ?? 0) + plans.length > options.dailyMaxRequests) {
        throw budgetError('The local daily search limit has been reached.');
      }
      const counters = this.data.months[month] ?? {};
      for (const plan of plans) {
        const current = counters[plan.identity] ?? emptyCounters();
        const localLimit = options[`${plan.provider}MonthlyLimit`];
        const next = plan.provider === 'tavily' ? current.tavilyCredits + plan.credits : current.requests + 1;
        if (localLimit && next > localLimit) throw budgetError(`${plan.provider} has reached its local monthly limit.`);
      }
      const before = structuredClone(this.data);
      this.turns.set(turnKey, { requests: turn.requests + plans.length, tavilyCredits: turn.tavilyCredits + credits });
      this.data.days[day] = (this.data.days[day] ?? 0) + plans.length;
      this.data.months[month] ??= {};
      for (const plan of plans) {
        const current = this.data.months[month][plan.identity] ??= emptyCounters();
        current.requests++;
        current.tavilyCredits += plan.credits;
      }
      // Retain recent counters, not an unbounded history.
      for (const key of Object.keys(this.data.days)) if (key < new Date(this.now() - 40 * 86400000).toISOString().slice(0, 10)) delete this.data.days[key];
      const months = Object.keys(this.data.months).sort();
      for (const key of months.slice(0, -3)) delete this.data.months[key];
      if (this.turns.size > 500) for (const key of [...this.turns.keys()].slice(0, 100)) if (key !== turnKey) this.turns.delete(key);
      try { await this.persist(); }
      catch (error) { this.data = before; this.turns.set(turnKey, turn); throw error; }
      return plans.map(plan => ({ ...plan, month, day, turnKey, started: false, settled: false }));
    });
  }

  settle(receipt, outcome) {
    return this.exclusive(async () => {
      if (receipt.settled) return;
      receipt.settled = true;
      const counter = this.data.months[receipt.month]?.[receipt.identity];
      const turn = this.turns.get(receipt.turnKey);
      if (!counter) return;
      if (!receipt.started) {
        counter.requests--;
        counter.tavilyCredits -= receipt.credits;
        this.data.days[receipt.day]--;
        if (turn) { turn.requests--; turn.tavilyCredits -= receipt.credits; }
      } else {
        counter[outcome.ok ? 'successes' : 'errors']++;
        if (finite(outcome.usage?.estimatedUsd)) { counter.estimatedUsd += outcome.usage.estimatedUsd; counter.costReportedRequests++; }
        if (receipt.provider === 'tavily') {
          const actual = finite(outcome.usage?.credits) ? outcome.usage.credits : outcome.rejected ? 0 : receipt.credits;
          counter.tavilyCredits += actual - receipt.credits;
          if (turn) turn.tavilyCredits += actual - receipt.credits;
          if (outcome.usage?.creditsReported) counter.confirmedCredits += actual;
          else if (!outcome.rejected) counter.uncertain++;
        }
      }
      await this.persist();
    });
  }

  view(identity) {
    return this.exclusive(async () => {
      const { month, day } = this.period();
      return { period: month, todayRequests: this.data.days[day] ?? 0,
        ...structuredClone(this.data.months[month]?.[identity] ?? emptyCounters()) };
    });
  }

  turnView(key) { return { ...(this.turns.get(key) ?? { requests: 0, tavilyCredits: 0 }) }; }
  async flush() { await this.tail; await this.ready; }
}
