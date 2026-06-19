using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Microsoft.AspNetCore.Hosting;
using Newtonsoft.Json;
using Lime_Editor.Models;

namespace Lime_Editor.Services
{
    // «Eject» (Итерация 4): экспорт сайта в готовый фуллстак-проект Next.js (App Router).
    // КЛЮЧЕВОЙ ПРИЁМ: проект переиспользует НАШ рендерер lime-doc.js (lib/limedoc.cjs) —
    // страницы рендерятся тем же кодом, что и на хостинге, поэтому нет двойной поддержки
    // (каждый блок/эффект уже работает). Бэкенд: Prisma/SQLite + /api/form + серверная
    // загрузка записей коллекций для блока collectionList.
    public sealed class NextExportService
    {
        private readonly IWebHostEnvironment _env;
        private readonly IDocumentRenderer _renderer;

        public NextExportService(IWebHostEnvironment env, IDocumentRenderer renderer)
        {
            _env = env;
            _renderer = renderer;
        }

        // idiomatic=false → страницы рендерятся движком (HTML-блоб); true → настоящие
        // React-компоненты на частые блоки + fallback на движок для сложных.
        public byte[] BuildZip(string siteName, string documentJson,
            IEnumerable<Collection> collections, IEnumerable<CollectionRecord> records, bool idiomatic = false)
        {
            documentJson = string.IsNullOrWhiteSpace(documentJson) ? "{\"version\":1,\"pages\":[]}" : documentJson;

            // Сид коллекций: [{ slug, name, schemaJson, records: [dataJson,...] }]
            var recsByCol = records.GroupBy(r => r.CollectionId).ToDictionary(g => g.Key, g => g.ToList());
            var seed = collections.Select(c => new
            {
                slug = c.Slug,
                name = c.Name,
                schemaJson = c.SchemaJson,
                records = (recsByCol.TryGetValue(c.Id, out var rs) ? rs : new List<CollectionRecord>())
                    .Select(r => r.DataJson).ToList()
            }).ToList();
            var seedJson = JsonConvert.SerializeObject(seed);

            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                Add(zip, "package.json", PackageJson);
                Add(zip, "next.config.mjs", NextConfig);
                Add(zip, ".env", "DATABASE_URL=\"file:./dev.db\"\n");
                Add(zip, ".gitignore", "node_modules\n.next\ndev.db\n");
                Add(zip, "README.md", Readme(siteName));
                Add(zip, "prisma/schema.prisma", PrismaSchema);
                Add(zip, "prisma/seed.mjs", SeedMjs(seedJson));
                // общее для обоих режимов
                Add(zip, "lib/limedoc.cjs", ReadWebFile("js/lime/lime-doc.js"));
                Add(zip, "lib/doc.json", documentJson);
                Add(zip, "lib/prisma.mjs", PrismaMjs);
                Add(zip, "lib/data.mjs", DataMjs);
                Add(zip, "app/lime.css", BuildCss());
                Add(zip, "app/api/form/route.js", FormRouteJs);
                Add(zip, "public/js/lime-animate.js", ReadWebFile("js/lime/lime-animate.js"));
                Add(zip, "public/js/lime-polish.js", ReadWebFile("js/lime/lime-polish.js"));

                if (idiomatic)
                {
                    // Идиоматичный режим: реальные React-компоненты + скомпилированный CSS блоков.
                    Add(zip, "app/blocks.css", _renderer.CompileCss(documentJson));
                    Add(zip, "lib/doc.mjs", "export const doc = " + documentJson + ";\nexport const components = doc.components || {};\n");
                    Add(zip, "lib/renderblock.mjs", RenderBlockMjs);
                    Add(zip, "components/Blocks.jsx", BlocksJsx);
                    Add(zip, "app/layout.jsx", LayoutJsx.Replace("import './lime.css';", "import './lime.css';\nimport './blocks.css';"));
                    Add(zip, "app/page.jsx", HomePageJsxIdiomatic);
                    Add(zip, "app/[slug]/page.jsx", SlugPageJsxIdiomatic);
                }
                else
                {
                    // Блоб-режим: страницы рендерит движок.
                    Add(zip, "lib/render.mjs", RenderMjs);
                    Add(zip, "app/layout.jsx", LayoutJsx);
                    Add(zip, "app/page.jsx", HomePageJsx);
                    Add(zip, "app/[slug]/page.jsx", SlugPageJsx);
                }
            }
            return ms.ToArray();
        }

        private static void Add(ZipArchive zip, string name, string content)
        {
            var entry = zip.CreateEntry(name);
            using var w = new StreamWriter(entry.Open());
            w.Write(content);
        }

        private string ReadWebFile(string rel)
        {
            var path = Path.Combine(_env.WebRootPath, rel.Replace('/', Path.DirectorySeparatorChar));
            return File.Exists(path) ? File.ReadAllText(path) : "";
        }

        // Дизайн-система + рантайм-CSS (как на публикации) одним файлом.
        private string BuildCss()
        {
            var parts = new[] { "tokens.css", "base.css", "components.css", "constructor.css" };
            return string.Join("\n\n", parts.Select(p => ReadWebFile("css/lime/" + p)));
        }

        // ----- статические файлы проекта -----
        private const string PackageJson = """
{
  "name": "lime-export",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "setup": "prisma generate && prisma db push && node prisma/seed.mjs",
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "seed": "node prisma/seed.mjs"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@prisma/client": "5.18.0"
  },
  "devDependencies": {
    "prisma": "5.18.0"
  }
}
""";

        private const string NextConfig = """
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: false };
export default nextConfig;
""";

        private const string PrismaSchema = """
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
model Collection {
  id         Int                @id @default(autoincrement())
  slug       String             @unique
  name       String
  schemaJson String
  records    CollectionRecord[]
}
model CollectionRecord {
  id           Int        @id @default(autoincrement())
  collectionId Int
  dataJson     String
  createdAt    DateTime   @default(now())
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
}
""";

        private static string SeedMjs(string seedJson) => """
// Заполняет БД коллекциями и записями, выгруженными из конструктора.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const collections = __SEED__;
for (const c of collections) {
  const col = await prisma.collection.upsert({
    where: { slug: c.slug },
    update: { name: c.name, schemaJson: c.schemaJson },
    create: { slug: c.slug, name: c.name, schemaJson: c.schemaJson },
  });
  // перезаливаем записи начисто, чтобы повторный seed не дублировал
  await prisma.collectionRecord.deleteMany({ where: { collectionId: col.id } });
  for (const dataJson of c.records) {
    await prisma.collectionRecord.create({ data: { collectionId: col.id, dataJson } });
  }
}
await prisma.$disconnect();
console.log('Seed done:', collections.length, 'collections');
""".Replace("__SEED__", seedJson);

        private const string PrismaMjs = """
import { PrismaClient } from '@prisma/client';
const g = globalThis;
export const prisma = g.__limePrisma ?? (g.__limePrisma = new PrismaClient());
""";

        private const string DataMjs = """
import { prisma } from './prisma.mjs';
// Карта данных коллекций для блока collectionList: { "<slug>": { fields, records } }.
export async function loadCollectionData() {
  try {
    const cols = await prisma.collection.findMany({ include: { records: true } });
    const map = {};
    for (const c of cols) {
      let fields = [];
      try { fields = JSON.parse(c.schemaJson || '[]'); } catch {}
      const records = c.records.map((r) => { try { return JSON.parse(r.dataJson); } catch { return {}; } });
      map[c.slug] = { fields, records };
    }
    return map;
  } catch {
    return {}; // БД ещё не инициализирована (npm run setup)
  }
}
""";

        private const string RenderMjs = """
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const LimeDoc = require('./limedoc.cjs');
const doc = require('./doc.json');

// Рендерит страницу тем же движком, что и хостинг. Формы подключаем к /api/form.
export function renderPage(slug, data) {
  const r = LimeDoc.renderPage(doc, slug || '', { baseUrl: '', data: data || null });
  if (!r) return null;
  const body = r.body.replace(/<form /g, '<form action="/api/form" method="post" ');
  return { title: r.title, body };
}

export function pageSlugs() {
  const pages = doc.pages && doc.pages.length ? doc.pages : [{ slug: '' }];
  return pages.map((p) => p.slug || '');
}
""";

        private const string LayoutJsx = """
import './lime.css';
import Script from 'next/script';

export const metadata = { title: 'Сайт' };

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=Manrope:wght@400;600;700;800&family=Unbounded:wght@400;600;700;800&family=Montserrat:wght@400;600;700;800&family=Onest:wght@400;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
      </head>
      <body className="lime-published">
        {children}
        <Script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" strategy="afterInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js" strategy="afterInteractive" />
        <Script src="/js/lime-animate.js" strategy="afterInteractive" />
        <Script src="/js/lime-polish.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
""";

        private const string HomePageJsx = """
import { renderPage } from '../lib/render.mjs';
import { loadCollectionData } from '../lib/data.mjs';

export const dynamic = 'force-dynamic'; // живые данные коллекций per-request

export default async function Home() {
  const data = await loadCollectionData();
  const r = renderPage('', data);
  return <div dangerouslySetInnerHTML={{ __html: r ? r.body : '' }} />;
}
""";

        private const string SlugPageJsx = """
import { renderPage } from '../../lib/render.mjs';
import { loadCollectionData } from '../../lib/data.mjs';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Page({ params }) {
  const data = await loadCollectionData();
  const r = renderPage(params.slug, data);
  if (!r) notFound();
  return <div dangerouslySetInnerHTML={{ __html: r.body }} />;
}
""";

        private const string FormRouteJs = """
import { prisma } from '../../../lib/prisma.mjs';
import { NextResponse } from 'next/server';

// Приём форм (фуллстак): пишет запись в коллекцию по скрытому полю __collection.
export async function POST(req) {
  const form = await req.formData();
  if (form.get('lime_hp')) return back(req); // honeypot
  const data = {};
  let slug = '';
  for (const [k, v] of form.entries()) {
    if (k === 'lime_hp' || k === 'lime_ts' || k === '__siteId') continue;
    if (k === '__collection') { slug = String(v); continue; }
    data[k] = String(v);
  }
  if (slug) {
    const col = await prisma.collection.findUnique({ where: { slug } });
    if (col) {
      await prisma.collectionRecord.create({ data: { collectionId: col.id, dataJson: JSON.stringify(data) } });
    }
  }
  return back(req);
}

function back(req) {
  const ref = req.headers.get('referer') || '/';
  return NextResponse.redirect(ref, 303);
}
""";

        // ----- идиоматичный режим (React-компоненты) -----
        private const string RenderBlockMjs = """
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const LimeDoc = require('./limedoc.cjs');
// Рендер одного блока движком — fallback для сложных блоков (фон/слои/дети/медиа).
export function renderBlockHtml(block, components, data) {
  return LimeDoc.renderBlock(block, { data: data || null }, components || {});
}
""";

        private const string HomePageJsxIdiomatic = """
import { doc } from '../lib/doc.mjs';
import { Block, Nav } from '../components/Blocks.jsx';
import { loadCollectionData } from '../lib/data.mjs';

export const dynamic = 'force-dynamic';

function pagesOf() {
  return doc.pages && doc.pages.length ? doc.pages : [{ slug: '', blocks: doc.blocks || [] }];
}

export default async function Home() {
  const data = await loadCollectionData();
  const ps = pagesOf();
  const page = ps.find((p) => !p.slug) || ps[0];
  return (
    <>
      <Nav pages={ps} current="" />
      <main className="lime-doc-page">
        {(page.blocks || []).map((b) => (
          <Block key={b.id} block={b} components={doc.components || {}} data={data} />
        ))}
      </main>
    </>
  );
}
""";

        private const string SlugPageJsxIdiomatic = """
import { doc } from '../../lib/doc.mjs';
import { Block, Nav } from '../../components/Blocks.jsx';
import { loadCollectionData } from '../../lib/data.mjs';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function pagesOf() {
  return doc.pages && doc.pages.length ? doc.pages : [{ slug: '', blocks: doc.blocks || [] }];
}

export default async function Page({ params }) {
  const ps = pagesOf();
  const page = ps.find((p) => (p.slug || '') === params.slug);
  if (!page) notFound();
  const data = await loadCollectionData();
  return (
    <>
      <Nav pages={ps} current={params.slug} />
      <main className="lime-doc-page">
        {(page.blocks || []).map((b) => (
          <Block key={b.id} block={b} components={doc.components || {}} data={data} />
        ))}
      </main>
    </>
  );
}
""";

        private const string BlocksJsx = """
import { renderBlockHtml } from '../lib/renderblock.mjs';

// Частые блоки рендерятся настоящими компонентами; сложные (фон/слои/дети/медиа) — движком.
const SIMPLE = new Set(['heading','text','cover','cta','buttonGroup','features','stats','pricing',
  'testimonials','accordion','steps','logos','socials','imageText','navbar','footer','image','divider','spacer']);

function fxClass(b) { return (b.fx && b.fx.length) ? ' ' + b.fx.map((k) => 'lime-fx-' + k).join(' ') : ''; }

function motionAttrs(b) {
  const a = {};
  if (b.anim) { a['data-anim'] = b.anim; if (b.animDelay) a['data-anim-delay'] = b.animDelay; if (b.animDuration) a['data-anim-duration'] = b.animDuration; }
  if (b.parallax) a['data-parallax'] = b.parallax;
  if (b.sticky) { a['data-sticky'] = '1'; if (b.stickyOffset) a['data-sticky-offset'] = b.stickyOffset; }
  const c = b.content || {};
  if (c.width === 'boxed') a['data-width'] = 'boxed';
  if (c.layout === 'bento') a['data-bento'] = '1';
  return a;
}

function ed(v, fb) { return (v === undefined || v === null || v === '') ? (fb || '') : v; }

function Section({ block, children }) {
  const b = block;
  return (
    <section className={'lime-block' + fxClass(b)} data-block-type={b.type} data-block-id={b.id} {...motionAttrs(b)}>
      <div className="lime-block__inner">{children}</div>
    </section>
  );
}

function Content({ block }) {
  const b = block, c = b.content || {};
  switch (b.type) {
    case 'heading': return <h2 className="lime-block__heading">{ed(c.text, 'Раздел')}</h2>;
    case 'text': return <p className="lime-block__text">{ed(c.text, 'Текст абзаца.')}</p>;
    case 'cover': return (
      <div className="lime-block__cover">
        <div className="lime-block__cover-uptitle">{ed(c.uptitle, 'Your brand')}</div>
        <h1 className="lime-block__cover-title">{ed(c.title, 'Заголовок')}</h1>
        <p className="lime-block__cover-desc">{ed(c.desc, 'Короткое описание.')}</p>
        <a href="#" className="lime-block__cover-cta">{ed(c.cta, 'Начать →')}</a>
      </div>
    );
    case 'cta': return (
      <div className="lime-block__cta">
        <h3>{ed(c.title, 'Готов начать?')}</h3>
        <p>{ed(c.desc, 'Опиши предложение.')}</p>
        <a href="#" className="lime-block__cta-btn">{ed(c.btn, 'Действие →')}</a>
      </div>
    );
    case 'buttonGroup': return (
      <div className="lime-block__btn-group">
        <a href="#" className="lime-block__cta-btn">{ed(c.primary, 'Основное действие')}</a>
        <a href="#" className="lime-block__btn-ghost">{ed(c.secondary, 'Вторично')}</a>
      </div>
    );
    case 'features': return (
      <div className="lime-block__features">
        {(c.items || []).map((it, i) => (
          <div className="lime-block__feature" key={i}>
            <div className="lime-block__feature-icon">{it.icon}</div>
            <h4 className="lime-block__feature-title">{it.title}</h4>
            <p className="lime-block__feature-desc">{it.desc}</p>
          </div>
        ))}
      </div>
    );
    case 'stats': return (
      <div className="lime-block__stats">
        {(c.items || []).map((it, i) => (
          <div className="lime-block__stat" key={i}>
            <div className="lime-block__stat-num">{it.num}</div>
            <div className="lime-block__stat-label">{it.label}</div>
          </div>
        ))}
      </div>
    );
    case 'pricing': return (
      <div className="lime-block__pricing">
        {(c.plans || []).map((p, i) => (
          <div className={'lime-block__plan' + (p.featured ? ' is-featured' : '')} key={i}>
            <div className="lime-block__plan-name">{p.name}</div>
            <div className="lime-block__plan-price"><span>{p.price}</span><small>{p.period}</small></div>
            <ul className="lime-block__plan-features">{(p.features || []).map((f, fi) => <li key={fi}>{f}</li>)}</ul>
            <a href="#" className="lime-block__cta-btn">{p.cta || 'Выбрать'}</a>
          </div>
        ))}
      </div>
    );
    case 'testimonials': return (
      <div className="lime-block__testimonials">
        {(c.items || []).map((it, i) => (
          <figure className="lime-block__testimonial" key={i}>
            <blockquote>{it.quote}</blockquote>
            <figcaption><b>{it.author}</b><span>{it.role}</span></figcaption>
          </figure>
        ))}
      </div>
    );
    case 'accordion': return (
      <div className="lime-block__accordion">
        {(c.items || []).map((it, i) => (
          <details className="lime-block__accordion-item" key={i} open={i === 0}>
            <summary>{it.q}</summary>
            <div className="lime-block__accordion-a">{it.a}</div>
          </details>
        ))}
      </div>
    );
    case 'steps': return (
      <div className="lime-block__steps">
        {(c.items || []).map((it, i) => (
          <div className="lime-block__step" key={i}>
            <div className="lime-block__step-num">{i + 1}</div>
            <h4>{it.title}</h4><p>{it.desc}</p>
          </div>
        ))}
      </div>
    );
    case 'logos': return (
      <div className="lime-block__logos">{(c.items || []).map((it, i) => <span className="lime-block__logo" key={i}>{it.label}</span>)}</div>
    );
    case 'socials': return (
      <div className="lime-block__socials">{(c.items || []).map((it, i) => <a className="lime-block__social" href={it.url || '#'} key={i}>{it.platform}</a>)}</div>
    );
    case 'imageText': return (
      <div className={'lime-block__imagetext' + (c.reverse ? ' is-reverse' : '')}>
        <div className="lime-block__imagetext-media">{c.src ? <img src={c.src} alt={c.alt || ''} loading="lazy" /> : null}</div>
        <div className="lime-block__imagetext-body">
          <h3>{ed(c.title, 'Заголовок секции')}</h3>
          <p>{ed(c.text, 'Описание.')}</p>
        </div>
      </div>
    );
    case 'navbar': return (
      <nav className="lime-block__navbar">
        <div className="lime-block__navbar-brand">{ed(c.brand, 'Brand')}</div>
        <div className="lime-block__navbar-links">{(c.links || []).map((l, i) => <a className="lime-block__navbar-link" href="#" key={i}>{l.label}</a>)}</div>
        <a href="#" className="lime-block__cta-btn">{ed(c.cta, 'Начать')}</a>
      </nav>
    );
    case 'footer': return (
      <div className="lime-block__footer">
        <div className="lime-block__footer-brand">
          <div className="lime-block__footer-name">{ed(c.brand, 'Brand')}</div>
          <p className="lime-block__footer-tagline">{ed(c.tagline, '')}</p>
        </div>
        <div className="lime-block__footer-cols">{(c.columns || []).map((col, ci) => (
          <div className="lime-block__footer-col" key={ci}><h5>{col.title}</h5>{(col.links || []).map((l, li) => <a href="#" key={li}>{l.label}</a>)}</div>
        ))}</div>
        <div className="lime-block__footer-copy">{ed(c.copyright, '© 2026')}</div>
      </div>
    );
    case 'image': return (
      <figure className="lime-block__image">
        {c.src ? <img src={c.src} alt={c.alt || ''} loading="lazy" /> : null}
        {c.caption ? <figcaption className="lime-block__image-caption">{c.caption}</figcaption> : null}
      </figure>
    );
    case 'divider': return <div className="lime-block__divider"><span /></div>;
    case 'spacer': return <div className="lime-block__spacer" />;
    default: return null;
  }
}

function CollectionList({ block, data }) {
  const c = block.content || {};
  const ds = (data && data[c.collection]) || null;
  const fields = (ds && ds.fields) || [];
  const records = (ds && ds.records) || [];
  return (
    <section className="lime-block" data-block-type="collectionList" data-block-id={block.id}>
      <div className="lime-block__inner">
        {!c.collection
          ? <div className="lime-doc-drop-hint">Список из коллекции — источник не выбран.</div>
          : <div className="lime-block__collection">
              {records.map((rec, i) => (
                <div className="lime-cl-card" key={i}>
                  {fields.map((f, fi) => f.type === 'image'
                    ? (rec[f.name] ? <img className="lime-cl-img" src={rec[f.name]} alt="" loading="lazy" key={fi} /> : <div className="lime-cl-img lime-cl-img--ph" key={fi} />)
                    : <div className="lime-cl-row" key={fi}><span className="lime-cl-key">{f.label || f.name}</span><span className="lime-cl-val">{rec[f.name] || ''}</span></div>)}
                </div>
              ))}
            </div>}
      </div>
    </section>
  );
}

function RawBlock({ block, components, data }) {
  return <div dangerouslySetInnerHTML={{ __html: renderBlockHtml(block, components, data) }} />;
}

export function Block({ block, components, data }) {
  const b = block, c = b.content || {};
  const complex = (c && c.bg) || (b.layers && b.layers.length) || (b.children && b.children.length) || b.marquee || b.scene;
  if (b.type === 'collectionList') return <CollectionList block={b} data={data} />;
  if (!complex && SIMPLE.has(b.type)) return <Section block={b}><Content block={b} /></Section>;
  return <RawBlock block={b} components={components} data={data} />;
}

export function Nav({ pages, current }) {
  if (!pages || pages.length <= 1) return null;
  return (
    <nav className="lime-doc-nav">
      {pages.map((p, i) => {
        const slug = p.slug || '';
        const href = slug === '' ? '/' : '/' + slug;
        return <a href={href} className={slug === current ? 'is-active' : ''} key={i}>{p.title || p.slug || 'Стр.'}</a>;
      })}
    </nav>
  );
}
""";

        private static string Readme(string siteName) => $$"""
# {{siteName}} — экспорт (Next.js)

Готовый фуллстак-проект: фронт (Next.js App Router) + бэк (API-роуты) + БД (Prisma/SQLite).
Страницы рендерятся тем же движком, что и на хостинге Lime.

## Запуск
```bash
npm install
npm run setup   # генерирует Prisma-клиент, создаёт БД и заливает данные коллекций
npm run dev     # http://localhost:3000
```

## Что внутри
- `lib/limedoc.cjs` — движок рендера (переиспользован с платформы).
- `lib/doc.json` — документ сайта (источник правды).
- `app/` — страницы (App Router), рендерят документ.
- `app/api/form/route.js` — приём форм → запись в коллекцию.
- `prisma/` — схема БД + сид данных коллекций.
- `public/js/` — рантайм анимаций/лоска.

## Деплой
Любой хостинг Next.js (Vercel и т.п.). Для прод-БД поменяй провайдера в `prisma/schema.prisma`
(например, на PostgreSQL) и `DATABASE_URL` в `.env`.
""";
    }
}
