import { getDb } from "@/lib/db";
import { weeklyPlan } from "@/lib/plan";
import { planCreateAction } from "../actions";

export const dynamic = "force-dynamic";

const DAY = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export default function PlanPage() {
  const plan = weeklyPlan(getDb());
  return (
    <div className="grid">
      <section className="card full">
        <h2>Haftalık yayın planı</h2>
        <p className="muted">
          Haftada 3 video: Salı, Perşembe, Cumartesi. Kanal panosundaki rakamlar arttıkça plan en
          iyi türlere kayar; aynı tür üst üste gelmez, haftada bir yeni tür denenir. Bir satırdaki
          düğme projeyi oluşturup 3 varyasyonu hazırlamaya başlar; videoyu planlanan güne kadar
          seçip yükleyebilirsin.
        </p>
        <table>
          <thead>
            <tr>
              <th>Gün</th>
              <th>Tür</th>
              <th>Süre</th>
              <th>Ekran kararması</th>
              <th>Neden</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => (
              <tr key={p.date}>
                <td>
                  {DAY[new Date(`${p.date}T12:00:00`).getDay()]} {p.date.slice(8)}.
                  {p.date.slice(5, 7)}
                </td>
                <td>{p.label}</td>
                <td>{p.hours} saat</td>
                <td>{p.dark ? `${p.dark} dk` : "kapalı"}</td>
                <td className="muted">{p.reason}</td>
                <td>
                  <form action={planCreateAction}>
                    <input type="hidden" name="category" value={p.category} />
                    <input type="hidden" name="hours" value={p.hours} />
                    <input type="hidden" name="date" value={p.date} />
                    <button type="submit" style={{ marginTop: 0 }}>
                      Oluştur ve 3 varyasyon hazırla
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
