/** Panneau technique : simulation des sources, détail du dernier appel, journal. */
import { useCallback, useEffect, useState } from "react";
import { demoApi, onToolCall, type Client, type DemoTenant, type JournalEntry, type SimulationState, type ToolLog } from "../api";

export function TechPanel({ tenant, client, onChange }: { tenant: DemoTenant; client: Client; onChange: () => void }) {
  const [sim, setSim] = useState<SimulationState>();
  const [logs, setLogs] = useState<ToolLog[]>([]);
  const [journal, setJournal] = useState<{ entries: JournalEntry[]; integrity: { ok: boolean } }>();

  const refresh = useCallback(async () => {
    const [s, j] = await Promise.all([demoApi.simulation(), client.journal()]);
    if (s.ok) setSim(s.data);
    if (j.ok) setJournal(j.data);
  }, [client]);

  useEffect(() => {
    void refresh();
    const off = onToolCall((l) => {
      setLogs((prev) => [l, ...prev].slice(0, 12));
      setTimeout(() => void refresh(), 150);
    });
    return () => {
      off();
    };
  }, [refresh]);

  const patch = async (p: Record<string, unknown>) => {
    await demoApi.setSimulation(p);
    await refresh();
    onChange();
  };

  const last = logs.find((l) => l.response);
  const maxMs = Math.max(1, ...(last?.response?.meta.timings.map((t) => t.ms) ?? [1]), last?.response?.meta.budgetMs ?? 1);

  return (
    <section className="tech" aria-label="Panneau technique">
      <div className="tech-col">
        <h3>Sources de {tenant.name}</h3>
        <table className="sim">
          <thead>
            <tr>
              <th>Connecteur</th>
              <th>Accès</th>
              <th>Panne</th>
              <th>Lent ×4</th>
            </tr>
          </thead>
          <tbody>
            {tenant.connectors.map((c) => {
              const p = sim?.connectors[c.id];
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.id}</strong>
                    <div className="muted small">{c.vendor}</div>
                  </td>
                  <td>
                    <span className="badge">{c.access.toUpperCase()}</span>
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`Panne ${c.id}`} checked={Boolean(p?.down)} onChange={(e) => void patch({ connector: c.id, down: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`Lenteur ${c.id}`} checked={(p?.slowFactor ?? 1) > 1} onChange={(e) => void patch({ connector: c.id, slowFactor: e.target.checked ? 4 : 1 })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="toggles">
          <label>
            <input type="checkbox" checked={Boolean(sim?.layerDown)} onChange={(e) => void patch({ layerDown: e.target.checked })} /> UA Intelligence indisponible
          </label>
          <label>
            <input type="checkbox" checked={Boolean(sim?.cacheDown)} onChange={(e) => void patch({ cacheDown: e.target.checked })} /> Cache principal en panne
          </label>
          <label>
            Modèle du chat{" "}
            <select value={sim?.llmMode ?? "normal"} onChange={(e) => void patch({ llmMode: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="down">Fournisseur en panne</option>
              <option value="hallucinate">Invente un produit</option>
            </select>
          </label>
          <button className="btn" onClick={() => void patch({ reset: true })}>
            Réinitialiser
          </button>
        </div>
        {sim && (
          <p className="muted small">
            Cache : {sim.cache.hit} hit · {sim.cache.miss} miss · {sim.cache.stale} stale · {sim.cache.coalesced} coalescées
          </p>
        )}
      </div>

      <div className="tech-col">
        <h3>Dernier appel {last ? <code>{last.tool}</code> : null}</h3>
        {last?.response ? (
          <>
            <p className="muted small">
              {last.response.meta.durationMs} ms pour un budget de {last.response.meta.budgetMs} ms · niveau {last.response.meta.level}
              {last.response.partial ? " · réponse partielle" : ""}
            </p>
            <ul className="waterfall">
              {last.response.meta.timings.map((t, i) => (
                <li key={i}>
                  <span className="wf-label">
                    {t.connector} <span className="muted">{t.capability}</span>
                  </span>
                  <span className="wf-bar">
                    <span className={`wf-fill ${t.outcome} ${t.cache}`} style={{ width: `${Math.max(2, (t.ms / maxMs) * 100)}%` }} />
                  </span>
                  <span className="wf-ms">
                    {t.ms} ms · {t.outcome === "ok" ? t.cache : t.outcome}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">{logs[0]?.error ?? "Aucun appel pour l'instant."}</p>
        )}
        <h3>Appels récents</h3>
        <ul className="calls">
          {logs.map((l, i) => (
            <li key={i}>
              <code>{l.tool}</code> {l.response ? `${l.response.meta.durationMs} ms${l.response.partial ? " · partiel" : ""}` : `${l.status} ${l.error ?? ""}`}
            </li>
          ))}
        </ul>
      </div>

      <div className="tech-col">
        <h3>
          Journal {journal && <span className={`badge ${journal.integrity.ok ? "ok" : "warn"}`}>{journal.integrity.ok ? "chaîne intègre" : "chaîne rompue"}</span>}
        </h3>
        <ul className="journal">
          {journal?.entries.slice(0, 14).map((e) => (
            <li key={e.seq}>
              <span className="muted small">#{e.seq} {new Date(e.at).toLocaleTimeString("fr-FR")}</span> <code>{e.tool}</code> {e.channel} · {e.caller.level} · consentement {e.consent} · {e.outcome}
              {e.partial ? " · partiel" : ""}
              {e.aiGenerated ? " · IA" : ""}
              <div className="muted small">
                {e.customerRef ? `client ${e.customerRef} · ` : ""}
                {e.connectorsRead.join(", ") || "aucune source"} · {e.hash.slice(0, 10)}…
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
