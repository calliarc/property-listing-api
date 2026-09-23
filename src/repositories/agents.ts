import type { Db } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';
import { Params } from '../lib/listing-query.js';
import { pageMeta, type PageMeta } from '../schemas/common.js';
import type { Agent, AgentCreate, AgentListQuery, AgentUpdate } from '../schemas/agent.js';

const COLUMNS = 'id, name, email, phone, brokerage, license_number, created_at, updated_at';
const FIELDS = ['name', 'email', 'phone', 'brokerage', 'license_number'] as const;

type AgentRow = Omit<Agent, 'created_at' | 'updated_at'> & { created_at: Date; updated_at: Date };

const toAgent = (r: AgentRow): Agent => ({
  ...r,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

export class AgentRepository {
  constructor(private readonly db: Db) {}

  async list(query: AgentListQuery): Promise<{ data: Agent[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const p = new Params();
    const where = query.q ? `WHERE name ILIKE ${p.add(`%${escapeLike(query.q)}%`)} OR brokerage ILIKE $1` : '';
    const countValues = [...p.values];
    const { rows } = await this.db.query<AgentRow>(
      `SELECT ${COLUMNS} FROM agents ${where} ORDER BY name ASC, id ASC LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    const count = await this.db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM agents ${where}`, countValues);
    const total = count.rows[0]?.total ?? 0;
    return { data: rows.map(toAgent), meta: pageMeta(page, limit, total) };
  }

  async findById(id: string): Promise<Agent | undefined> {
    const { rows } = await this.db.query<AgentRow>(`SELECT ${COLUMNS} FROM agents WHERE id = $1`, [id]);
    return rows[0] ? toAgent(rows[0]) : undefined;
  }

  async create(input: AgentCreate): Promise<Agent> {
    const p = new Params();
    const cols: string[] = [];
    const vals: string[] = [];
    for (const f of FIELDS) {
      if (input[f] !== undefined) {
        cols.push(f);
        vals.push(p.add(f === 'email' ? input.email.toLowerCase() : input[f]));
      }
    }
    const { rows } = await this.db.query<AgentRow>(
      `INSERT INTO agents (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING ${COLUMNS}`,
      p.values,
    );
    return toAgent(rows[0]!);
  }

  async update(id: string, input: AgentUpdate): Promise<Agent | undefined> {
    const p = new Params();
    const sets: string[] = [];
    for (const f of FIELDS) {
      const value = input[f];
      if (value !== undefined) sets.push(`${f} = ${p.add(f === 'email' && value ? String(value).toLowerCase() : value)}`);
    }
    if (sets.length === 0) throw new HttpError(400, 'No updatable fields provided');
    const { rows } = await this.db.query<AgentRow>(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = ${p.add(id)} RETURNING ${COLUMNS}`,
      p.values,
    );
    return rows[0] ? toAgent(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM agents WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
