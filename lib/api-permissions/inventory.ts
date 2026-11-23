/**
 * PERMISOS API — «Lo que tiene hoy» (servidor): el ÚLTIMO inventario escaneado
 * de un agente + sus empresas, el perfil del puente por empresa y su gobierno.
 * Solo lectura y consultas parametrizadas (mssql, como ./db.ts).
 *
 * Tablas: agent, agent_inventory, agent_inventory_mcp, agent_company,
 * chat_project_agent_config y agent_governance. NO se lee agent_inventory_runtime
 * (tiene huellas de tokens y detalles de autenticación) y del destino de cada
 * conector solo sale el esquema + host (safeConnectorTarget).
 * Las reglas de comparación (clasificación y alertas) están en ./inventory-rules.ts.
 */
import 'server-only';
import { profileLabel } from '../chat/projects-rules';
import { sql, withMssqlPool } from '../mssqlPool';
import {
  classifyConnector,
  countSkills,
  safeConnectorTarget,
  splitWriteTools,
  summarizeToolRules,
  type AgentInventoryView,
  type InventoryScan,
} from './inventory-rules';

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/** Tabla opcional que podría no existir en una base (p. ej. un módulo sin instalar). */
function isMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid object name|no es válido|nombre de objeto/i.test(message);
}

async function optional<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingTable(error)) return fallback;
    throw error;
  }
}

/** null = no existe un agente con ese código. */
export async function getAgentInventory(code: string): Promise<AgentInventoryView | null> {
  return withMssqlPool(async (pool) => {
    const agentRows = await pool
      .request()
      .input('code', sql.NVarChar(60), code)
      .query<{ id_agent: number; code: string; display_name: string; is_active: boolean }>(
        'SELECT TOP 1 id_agent, code, display_name, is_active FROM dbo.agent WHERE LOWER(code) = LOWER(@code)'
      );
    const agent = agentRows.recordset[0];
    if (!agent) return null;
    const idAgent = agent.id_agent;

    const invRows = await pool
      .request()
      .input('idAgent', sql.Int, idAgent)
      .query<{
        id: number;
        scanned_at: Date;
        kind: string;
        host: string;
        model: string | null;
        service_status: string | null;
        exec_mode: string | null;
        exec_requires_approval: boolean | null;
        tools_json: string | null;
        skills_json: string | null;
        scan_error: string | null;
      }>(
        `SELECT TOP 1 id, scanned_at, kind, host, model, service_status, exec_mode, exec_requires_approval,
                tools_json, skills_json, scan_error
           FROM dbo.agent_inventory
          WHERE id_agent = @idAgent
          ORDER BY scanned_at DESC, id DESC`
      );
    const inv = invRows.recordset[0];

    let scan: InventoryScan | null = null;
    if (inv) {
      const mcpRows = await pool
        .request()
        .input('idInventory', sql.Int, inv.id)
        .query<{
          name: string;
          transport: string;
          target: string | null;
          company: string | null;
          access: string;
          auth: string;
          write_tools: string | null;
        }>(
          `SELECT name, transport, target, company, access, auth, write_tools
             FROM dbo.agent_inventory_mcp
            WHERE id_inventory = @idInventory
            ORDER BY name`
        );
      scan = {
        scannedAt: iso(inv.scanned_at) ?? '',
        kind: inv.kind,
        host: inv.host,
        model: inv.model,
        serviceStatus: inv.service_status,
        execMode: inv.exec_mode,
        execRequiresApproval: inv.exec_requires_approval === null ? null : Boolean(inv.exec_requires_approval),
        ...summarizeToolRules(inv.tools_json),
        skillsCount: countSkills(inv.skills_json),
        scanError: inv.scan_error ? 'El escaneo no pudo leer al agente completo.' : null,
        connectors: mcpRows.recordset.map((m) => ({
          name: m.name,
          transport: m.transport,
          // NUNCA el destino completo: solo esquema + host de un HTTP/SSE.
          host: safeConnectorTarget(m.target, m.transport),
          company: m.company,
          access: m.access,
          auth: m.auth,
          writeTools: splitWriteTools(m.write_tools),
          classification: classifyConnector(m),
        })),
      };
    }

    const companyRows = await pool
      .request()
      .input('idAgent', sql.Int, idAgent)
      .query<{ id_company: number; company: string; is_primary: boolean }>(
        `SELECT ac.id_company, c.company, ac.is_primary
           FROM dbo.agent_company ac
           INNER JOIN dbo.company c ON c.id_company = ac.id_company
          WHERE ac.id_agent = @idAgent
          ORDER BY ac.is_primary DESC, c.company`
      );

    const bridge = await optional<AgentInventoryView['bridge']>([], async () => {
      const r = await pool
        .request()
        .input('idAgent', sql.Int, idAgent)
        .query<{ id_company: number; company: string; enabled: boolean; profiles: string | null; reason: string | null }>(
          `SELECT cfg.id_company, c.company, cfg.enabled, cfg.profiles, cfg.reason
             FROM dbo.chat_project_agent_config cfg
             INNER JOIN dbo.company c ON c.id_company = cfg.id_company
            WHERE cfg.id_agent = @idAgent
            ORDER BY c.company`
        );
      return r.recordset.map((b) => ({
        companyId: b.id_company,
        companyName: b.company.trim(),
        enabled: Boolean(b.enabled),
        // NULL = los perfiles por defecto del servidor para ese agente.
        profiles:
          b.profiles === null
            ? null
            : b.profiles
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
                .map((key) => ({ key, label: profileLabel(key) })),
        reason: b.reason,
      }));
    });

    const governance = await optional<AgentInventoryView['governance']>(null, async () => {
      const r = await pool
        .request()
        .input('idAgent', sql.Int, idAgent)
        .query<{
          director_name: string | null;
          director_email: string | null;
          privilege_template: string | null;
          privilege_applied_on: Date | null;
          notes: string | null;
          updated_by: string | null;
          updated_at: Date | null;
        }>(
          `SELECT director_name, director_email, privilege_template, privilege_applied_on, notes, updated_by, updated_at
             FROM dbo.agent_governance
            WHERE id_agent = @idAgent`
        );
      const g = r.recordset[0];
      if (!g) return null;
      return {
        directorName: g.director_name,
        directorEmail: g.director_email,
        privilegeTemplate: g.privilege_template,
        privilegeAppliedOn: iso(g.privilege_applied_on),
        notes: g.notes,
        updatedBy: g.updated_by,
        updatedAt: iso(g.updated_at),
      };
    });

    return {
      agent: { code: agent.code.toLowerCase(), name: agent.display_name, active: Boolean(agent.is_active) },
      scan,
      companies: companyRows.recordset.map((c) => ({ id: c.id_company, name: c.company.trim(), isPrimary: Boolean(c.is_primary) })),
      bridge,
      governance,
    };
  });
}
