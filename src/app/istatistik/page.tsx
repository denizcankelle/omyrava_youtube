import { getDb } from "@/lib/db";
import { type Row, summarize } from "@/lib/stats";

export const dynamic = "force-dynamic";

function Table({ rows, first }: { rows: Row[]; first: string }) {
  if (!rows.length) return <p className="muted">Veri yok.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{first}</th>
          <th>Video</th>
          <th>Görüntülenme / video</th>
          <th>İzlenme saati / video</th>
          <th>Ort. izleme</th>
          <th>Tıklama oranı</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{r.videos}</td>
            <td>{Math.round(r.views / r.videos).toLocaleString("tr-TR")}</td>
            <td>{(r.watchHours / r.videos).toFixed(1)}</td>
            <td>{r.avgViewMin !== null ? `${r.avgViewMin.toFixed(1)} dk` : "-"}</td>
            <td>{r.ctr !== null ? `%${r.ctr.toFixed(1)}` : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StatsPage() {
  const s = summarize(getDb());
  return (
    <div className="grid">
      <section className="card full">
        <h2>Kanal panosu</h2>
        <p className="muted">
          Rakamları her videonun sayfasındaki “İstatistik” bölümünden girersin (YouTube Studio ›
          Analiz). Özet her videonun en son girilen kaydına göre hesaplanır.
        </p>
        <p>
          <strong>{s.totals.videos}</strong> video ·{" "}
          <strong>{s.totals.views.toLocaleString("tr-TR")}</strong> görüntülenme ·{" "}
          <strong>{s.totals.watchHours.toFixed(0)}</strong> saat izlenme
        </p>
        <h3>Öneriler</h3>
        <ul>
          {s.advice.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </section>
      <section className="card full">
        <h3>Türlere göre</h3>
        <Table rows={s.byCategory} first="Tür" />
        <h3 style={{ marginTop: 20 }}>Sahnelere göre</h3>
        <Table rows={s.byScene} first="Sahne" />
      </section>
    </div>
  );
}
