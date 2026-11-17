import Link from "next/link";
import { getDb } from "@/lib/db";
import { CATEGORIES, formatDuration, listProjects } from "@/lib/projects";
import { STATUS_LABELS } from "@/lib/status";
import { CreateProjectForm } from "./CreateProjectForm";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = listProjects(getDb());
  return (
    <div className="grid">
      <section className="card">
        <h2>Yeni proje</h2>
        <CreateProjectForm />
      </section>
      <section className="card">
        <h2>Projeler</h2>
        {projects.length === 0 ? (
          <p className="empty">Henüz proje yok. Soldan ilk projeyi oluştur.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Başlık</th>
                <th>Kategori</th>
                <th>Süre</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{p.title}</Link>
                  </td>
                  <td>{CATEGORIES[p.category]}</td>
                  <td>{formatDuration(p.duration_sec)}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{STATUS_LABELS[p.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
