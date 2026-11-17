// ==UserScript==
// @name         Zentryx Lead Scanner
// @namespace    zarenk
// @version      1.5.1
// @description  Escanea Upwork, Facebook, Workana, Freelancer, Get on Board, LinkedIn, Computrabajo, Bumeran, LinkedIn posts, Torre, HN y bolsas remotas (APIs); filtra y avisa por Telegram.
// @match        https://www.upwork.com/*
// @match        https://www.facebook.com/*
// @match        https://www.workana.com/*
// @match        https://www.freelancer.com/*
// @match        https://www.getonbrd.com/*
// @match        https://www.linkedin.com/*
// @match        https://pe.computrabajo.com/*
// @match        https://www.bumeran.com.pe/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_openInTab
// @connect      api.telegram.org
// @connect      remoteok.com
// @connect      remotive.com
// @connect      himalayas.app
// @connect      jobicy.com
// @connect      www.workingnomads.com
// @connect      weworkremotely.com
// @connect      search.torre.co
// @connect      hn.algolia.com
// @updateURL    https://raw.githubusercontent.com/Zarenk/zentryx-lead-scanner/main/zentryx-lead-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/Zarenk/zentryx-lead-scanner/main/zentryx-lead-scanner.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ======================= CONFIGURACIÓN ======================= */
  const UP_BASE = 'https://www.upwork.com/nx/search/jobs/?payment_verified=1&sort=recency&per_page=50';
  const FB_RECENT = '&filters=eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9IiwicnBfY2hyb25vX3NvcnQ6MCI6IntcIm5hbWVcIjpcImNocm9ub3NvcnRcIixcImFyZ3NcIjpcIlwifSJ9';

  const CFG = {
    activeFrom: 6, activeTo: 23,       // horas Lima en que escanea (fuera de eso duerme)
    quietFrom: 23, quietTo: 7,         // avisos silenciosos (sin sonido) en este rango
    summaryHour: 21,                   // resumen diario por Telegram
    upwork: {
      dwellMin: 4,                     // minutos entre páginas => cada página se revisa cada ~16 min
      maxAgeMin: 180,                  // solo ofertas publicadas hace <= 3 h (el dedup evita repetidos)
      pages: [
        UP_BASE + '&q=' + encodeURIComponent('(nestjs OR nextjs OR "next.js" OR fastapi OR "ai agent" OR claude OR stripe OR supabase OR typescript OR llm)'),
        UP_BASE + '&q=' + encodeURIComponent('(python OR "node.js" OR openai OR langchain OR rag OR "ai automation" OR chatbot OR saas OR prisma OR postgresql)'),
        UP_BASE + '&q=' + encodeURIComponent('(erp OR "multi-tenant" OR "admin panel" OR dashboard OR mvp OR "web app" OR automation OR n8n OR webhook OR "api integration")'),
        UP_BASE + '&category2_uid=531770282580668418',
        'https://www.upwork.com/nx/find-work/best-matches',
      ],
    },
    facebook: {
      cycleMin: 40,                    // un ciclo completo (feeds + búsquedas) cada ~40 min (ritmo humano, cuenta personal)
      scrolls: 10,
      maxAgeHFeed: 72, maxAgeHSearch: 72,   // los grupos tienen poca actividad; el filtro de vistos evita repetidos
      feeds: [
        'https://www.facebook.com/groups/1025454714150122/?sorting_setting=CHRONOLOGICAL', // Programadores-Perú
        'https://www.facebook.com/groups/327987354235895/?sorting_setting=CHRONOLOGICAL',  // Bolsa de trabajo Perú
        'https://www.facebook.com/groups/808991849115782/?sorting_setting=CHRONOLOGICAL',  // Trabajos para programadores
        'https://www.facebook.com/groups/1497902218311845/?sorting_setting=CHRONOLOGICAL', // Claude Code en Español
        'https://www.facebook.com/groups/bolsatrabajo.it.developers/?sorting_setting=CHRONOLOGICAL',
        // v1.5.0: antes solo se usaban con búsqueda interna, que devuelve posts de hace meses
        'https://www.facebook.com/groups/proyectosfreelance/?sorting_setting=CHRONOLOGICAL',
        'https://www.facebook.com/groups/475265154766640/?sorting_setting=CHRONOLOGICAL',
        'https://www.facebook.com/groups/workia/?sorting_setting=CHRONOLOGICAL',
        'https://www.facebook.com/groups/494026930771842/?sorting_setting=CHRONOLOGICAL',
        'https://www.facebook.com/groups/699310987305660/?sorting_setting=CHRONOLOGICAL',
        'https://www.facebook.com/groups/empleos.programadores.remotos/?sorting_setting=CHRONOLOGICAL',
      ],
      searchGroups: ['proyectosfreelance', '475265154766640', 'workia', '494026930771842', '699310987305660', 'empleos.programadores.remotos'],
      searchTerms: ['busco programador', 'sistema', 'necesito', 'cotización', 'desarrollador', 'app', 'ERP', 'requiero'],
      // Búsqueda global de publicaciones recientes en TODO Facebook (grupos públicos de LATAM, etc.)
      globalTerms: ['busco programador', 'necesito un sistema', 'busco desarrollador web', 'necesito una app', 'cotizar sistema', 'busco desarrollador full stack', 'necesito automatizar'],
      searchesPerCycle: 1,             // búsquedas (en grupos + globales) rotativas por ciclo
    },
    // Pestaña "general": rota por estas webs (necesitan navegador; LinkedIn usa tu sesión).
    general: {
      dwellMin: 4,                     // minutos por fuente => cada fuente se revisa cada ~1 h
      sources: [
        { name: 'Workana', kind: 'project', url: 'https://www.workana.com/jobs?category=it-programming', link: /workana\.com\/job\/[^/]+/ },
        { name: 'Freelancer', kind: 'project', url: 'https://www.freelancer.com/jobs/nodejs/', link: /freelancer\.com\/projects\/[^/]+\/[^/]+/ },
        { name: 'Get on Board', kind: 'job', url: 'https://www.getonbrd.com/jobs/programming', link: /getonbrd\.com\/jobs\/[a-z-]+\/[a-z0-9-]{8,}/ },
        { name: 'Get on Board Node', kind: 'job', url: 'https://www.getonbrd.com/empleos-node-js', link: /getonbrd\.com\/jobs\/[a-z-]+\/[a-z0-9-]{8,}/ },
        { name: 'LinkedIn LATAM', kind: 'job', url: 'https://www.linkedin.com/jobs/search/?keywords=Node.js%20OR%20NestJS%20OR%20Next.js%20OR%20TypeScript%20OR%20%22full%20stack%22&location=Latin%20America&f_WT=2&f_TPR=r86400&sortBy=DD', link: /linkedin\.com\/jobs\/view\/\d+/ },
        { name: 'LinkedIn Perú', kind: 'job', url: 'https://www.linkedin.com/jobs/search/?keywords=desarrollador%20full%20stack%20OR%20backend%20OR%20Node.js&location=Per%C3%BA&f_WT=2&f_TPR=r86400&sortBy=DD', link: /linkedin\.com\/jobs\/view\/\d+/ },
        { name: 'Computrabajo programador', kind: 'local', url: 'https://pe.computrabajo.com/trabajo-de-programador?pubdate=1', link: /ofertas-de-trabajo\/oferta-de-trabajo/ },
        { name: 'Computrabajo desarrollador', kind: 'local', url: 'https://pe.computrabajo.com/trabajo-de-desarrollador?pubdate=1', link: /ofertas-de-trabajo\/oferta-de-trabajo/ },
        { name: 'Freelancer Python', kind: 'project', url: 'https://www.freelancer.com/jobs/python/', link: /freelancer\.com\/projects\/[^/]+\/[^/]+/ },
        { name: 'LinkedIn remoto global', kind: 'job', url: 'https://www.linkedin.com/jobs/search/?keywords=NestJS%20OR%20%22Node.js%22%20OR%20%22AI%20engineer%22%20OR%20FastAPI&geoId=92000000&f_WT=2&f_TPR=r86400&sortBy=DD', link: /linkedin\.com\/jobs\/view\/\d+/ },
        { name: 'LinkedIn posts ES', kind: 'posts', url: 'https://www.linkedin.com/search/results/content/?keywords=%22busco%20desarrollador%22%20OR%20%22busco%20programador%22%20OR%20%22necesito%20desarrollador%22&sortBy=%22date_posted%22' },
        { name: 'LinkedIn posts EN', kind: 'posts', url: 'https://www.linkedin.com/search/results/content/?keywords=%22hiring%22%20%22node.js%22%20remote%20OR%20%22looking%20for%20a%20developer%22%20nestjs&sortBy=%22date_posted%22' },
        { name: 'Bumeran', kind: 'local', url: 'https://www.bumeran.com.pe/empleos-busqueda-desarrollador.html?recientes=true', link: /bumeran\.com\.pe\/empleos\/[a-z0-9-]+\.html/ },
        { name: 'Workana IA', kind: 'project', url: 'https://www.workana.com/jobs?category=it-programming&query=inteligencia%20artificial', link: /workana\.com\/job\/[^/]+/ },
      ],
    },
    // Bolsas remotas por API/RSS: no necesitan pestaña; se consultan cada X min desde cualquier pestaña activa.
    apis: { everyMin: 30, maxAgeH: 48, firstRunMaxAgeH: 12 },
  };

  /* ======================= FILTROS OTRAS FUENTES ======================= */
  const GEN_POS = /\b(nest\.?js|node\.?js|typescript|javascript|next\.?js|react|postgres(ql)?|prisma|fastapi|python|django|stripe|agentes?|agents?|llm|claude|openai|gpt|chatgpt|rag|supabase|saas|api|backend|full[- ]?stack|automatizaci[oó]n|automation|chatbot|bot|erp|sistema|aplicaci[oó]n web|web app|plataforma|integraci[oó]n|inteligencia artificial|ia|ai|scraping|n8n|whatsapp|base de datos|sql)\b/gi;
  const PROJ_NEG = /\b(casino|gambling|betting|apuestas|signals bot|forex|wordpress|elementor|shopify|php|laravel|java\b|golang|rust|flutter|swift|kotlin|unity|unreal|solidity|web3|blockchain|data entry|dise[nñ]o gr[aá]fico|graphic design|logo|video|wix|webflow|bubble|salesforce|tester|manual test|seo\b|redacci[oó]n|traducci[oó]n|community manager)\b/i;
  const JOB_TITLE = /(node|nest|next\.?js|typescript|javascript|full ?-?stack|back ?-?end|software (engineer|developer)|desarrollador|programador|python|fastapi|react|ai engineer|llm|ingenier[oa] de software|web developer|integration)/i;
  const JOB_NEG = /\b(java\b|\.net|c#|php|ruby|golang|rust|ios|android|flutter|salesforce|sap\b|qa\b|tester|intern|internship|pr[aá]cticas?|practicante|trainee|junior|jr\.?|mainframe|cobol|embedded|firmware|devops|sre|data engineer|data scientist|designer|dise[nñ]ador)\b/i;
  const LOC_BAD = /(us only|usa only|united states only|u\.s\. only|us citizens?|must (be|reside|live) in (the )?(us|usa|united states|uk|eu|europe|canada)|europe only|eu only|uk only|emea only|on-?site|presencial|h[ií]brido|hybrid)/i;
  const locOK = (loc) => !loc || (/(worldwide|anywhere|global|latam|latin|americas|south america|per[uú]|remote$|remoto|work from anywhere)/i.test(loc) && !/\bonly\b/i.test(loc.replace(/latam only|americas only/i, '')));

  /* ======================= FILTROS UPWORK ======================= */
  const UP_POS = /\b(nest\.?js|node\.?js|typescript|javascript|next\.?js|react|postgres(ql)?|prisma|fastapi|python|django|flask|stripe|ai agents?|agents?|agentic|llm|claude|anthropic|openai|gpt|chatgpt|rag|mcp|supabase|saas|webhooks?|bullmq|redis|api|backend|full[- ]?stack|automation|langchain|langgraph|pgvector|multi-tenant|erp|docker|express|graphql|sql|n8n|chatbot|ai)\b/gi;
  const UP_CORE = /\b(nest|node|typescript|next|react|python|fastapi|stripe|ai (agent|engineer|developer|automation)|agent|llm|claude|openai|gpt|rag|mcp|backend|full[- ]?stack|saas|api|automation|chatbot|supabase|postgres)/i;
  const UP_NEG = /\b(wordpress|elementor|shopify theme|php|laravel|java\b|spring boot|golang|rust|flutter|swift|kotlin|unity|unreal|german|deutsch|solidity|web3|blockchain|data entry|video edit|graphic design|logo design|bubble\.io|webflow|wix|squarespace|salesforce|aem|qa engineer|manual test|tester|glide|must be (located|based) in|us only|usa only|only us|uk only|us citizens?|onsite|on-site|scraping|scraper|pakistan|india|philippines|bangladesh|copywrit\w*|writer|voice ?over|songs?|drama|music|annotat\w*|data label\w*|evaluate (a |the )?(new )?(foundation )?models?|rlhf|tutor|video ads|tutorial videos?|screen recording|voice|ugc|video editor|animator|casino|gambling|betting|signals bot|forex)\b/i;
  const UP_SCAM = /(client interviews|on (my|our) behalf|your (upwork )?account|account (rental|sharing)|\bbidder\b|lead generation partner|pay (you )?per interview|telegram me|whatsapp me)/i;

  /* ======================= FILTROS FACEBOOK ======================= */
  const FB_B = /(busc(o|amos|a|ando)\b|\(\d+ perf|\d+ perfiles|perfil(es)? requerid|(analista|ingeniero|desarrollador|programador|developer|engineer)[^.\n]{0,40}(senior|semi ?senior|ssr|sr\.?|junior|jr\.?|freelance|remoto)\b|(senior|semi ?senior|sr\.?)\s+(full ?stack|backend|developer|desarrollador)|estamos contratando|oportunidad laboral|se requiere|hiring|we.?re looking|looking for|necesit|requier|cotiz|se busca|vacante|convocatoria|contrat(ar|amos)|solicit|presupuesto|quien (me )?(haga|desarrolle|pueda)|quien sepa|alguien que (sepa|pueda|haga)|interesados? (escrib|envi)|env[ií]en (su )?cv|dejar contacto|recomi[eé]nden(me)? (un|a|alg)|cu[aá]nto (cobran|costar[ií]a|me cobrar))/i;
  const FB_T = /(sistema|software|app\b|aplicaci|web|programador|desarrollador|developer|full ?stack|backend|erp|punto de venta|\bpos\b|factura|bot\b|chatbot|\bia\b|inteligencia artificial|automatiz|plataforma|integraci|\bapi|node|python|react|next|nest|claude|agente|scraping|tienda virtual|e-?commerce|landing|base de datos|inventario|whatsapp|crm|reservas|delivery)/i;
  const FB_X = /(ofrezco|ofrecemos|brindamos|realiz(o|amos)|hacemos (p[aá]ginas|sistemas|apps)|desarrollo de software para|somos (una )?(empresa|agencia)|cursos?\b|clases|aprende|carrera|bootcamp|promoci[oó]n|descuento|busco (empleo|trabajo|nuevos proyectos|proyectos|oportunidad|clientes)|estoy buscando (empleo|trabajo)|practicantes|soy (programador|desarrollador|ingeniero|estudiante)|mi portafolio|disponible para|encuestador|embajador|asistente virtual|community manager|link de mega|power bi|presencial|cofundador|socio|ofrecer tus servicios|as[ií] quedar[ií]a tu negocio|sistema a la medida para|hosting|reseller|demo gratis|vendo |venta de)/i;

  /* ======================= UTILIDADES ======================= */
  const host = location.hostname.includes('upwork') ? 'upwork' : location.hostname.includes('facebook') ? 'facebook' : 'other';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));
  const hourNow = () => new Date().getHours() + new Date().getMinutes() / 60;
  const today = () => new Date().toISOString().slice(0, 10);
  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  function stat(key, inc = 1) {
    let s = GM_getValue('stats', {});
    if (s.date !== today()) s = { date: today(), upwork: 0, facebook: 0, leads: 0, errors: [] };
    if (key === 'error') s.errors = [...new Set([...(s.errors || []), inc])].slice(-10);
    else s[key] = (s[key] || 0) + inc;
    GM_setValue('stats', s);
  }

  function seenCheck(key) {
    const S = GM_getValue('seen', {});
    return !!S[key];
  }
  function seenAdd(keys) {
    const S = GM_getValue('seen', {});
    const now = Date.now();
    for (const k in S) if (now - S[k] > 14 * 864e5) delete S[k];
    keys.forEach((k) => (S[k] = now));
    GM_setValue('seen', S);
  }

  /* ======================= DIAGNÓSTICO SEMANAL ======================= */
  // Guarda por semana: cuántas ofertas/posts vio, cuántas pasaron, motivos de descarte,
  // "casi pasan" (descartadas por un solo motivo) y errores. Sirve para afinar filtros cada semana.
  const VERSION = '1.4.0';
  function weekKey() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  function diagLoad() {
    let D = GM_getValue('diag', null);
    if (!D || D.week !== weekKey()) {
      if (D) GM_setValue('diagPrev', D);
      D = { week: weekKey(), version: VERSION, keys: {}, errors: {},
            upwork: { vistos: 0, pasan: 0, motivos: {}, casi: [], enviados: [] },
            facebook: { vistos: 0, pasan: 0, motivos: {}, casi: [], enviados: [] } };
    }
    ['general', 'apis'].forEach((k) => { if (!D[k]) D[k] = { vistos: 0, pasan: 0, motivos: {}, casi: [], enviados: [] }; });
    return D;
  }
  function diag(src, why, sample) {
    const D = diagLoad();
    const k = src[0] + ':' + sample.slice(0, 50);
    if (D.keys[k]) return;                 // cada oferta/post se cuenta una sola vez por semana
    D.keys[k] = 1;
    const S = D[src];
    S.vistos++;
    if (!why.length) { S.pasan++; S.enviados = [...S.enviados, sample].slice(-40); }
    why.forEach((w) => (S.motivos[w] = (S.motivos[w] || 0) + 1));
    if (why.length === 1) S.casi = [...S.casi, why[0] + ' → ' + sample].slice(-40);
    if (Object.keys(D.keys).length > 4000) D.keys = {};
    GM_setValue('diag', D);
  }
  function diagErr(type) {
    const D = diagLoad();
    D.errors[type] = (D.errors[type] || 0) + 1;
    GM_setValue('diag', D);
  }
  function diagExport() {
    const strip = (D) => (D ? { ...D, keys: undefined } : null);
    return { version: VERSION, generado: new Date().toISOString(), semana: strip(diagLoad()), anterior: strip(GM_getValue('diagPrev', null)), hoy: GM_getValue('stats', {}) };
  }
  function diagMirror() { // copia legible desde la página de Upwork (Facebook borra su localStorage)
    if (host === 'upwork') try { localStorage.zscan_diag = JSON.stringify(diagExport()); } catch (e) {}
  }
  function weeklyReport() {
    const d = new Date();
    if (d.getDay() !== 0 || hourNow() < CFG.summaryHour || GM_getValue('lastWeekly') === weekKey()) return;
    GM_setValue('lastWeekly', weekKey());
    const D = diagLoad();
    const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
    tg(`Reporte semanal (desde ${D.week}, v${VERSION})\n` +
      `Upwork: ${D.upwork.vistos} ofertas en ventana, ${D.upwork.pasan} avisadas. Descartes: ${top(D.upwork.motivos)}\n` +
      `Facebook: ${D.facebook.vistos} posts en ventana, ${D.facebook.pasan} avisados. Descartes: ${top(D.facebook.motivos)}\n` +
      `Otras webs: ${D.general.vistos} vistas, ${D.general.pasan} avisadas. Descartes: ${top(D.general.motivos)}\n` +
      `Bolsas remotas (API): ${D.apis.vistos} vistas, ${D.apis.pasan} avisadas. Descartes: ${top(D.apis.motivos)}\n` +
      `Errores: ${top(D.errors)}\n` +
      `Para afinar: menú Tampermonkey → "Copiar diagnóstico" y pégalo a Claude.`, { silent: true });
  }

  /* ======================= TELEGRAM ======================= */
  function tg(text, opts = {}) {
    const h = hourNow();
    const silent = opts.silent ?? (h >= CFG.quietFrom || h < CFG.quietTo);
    const q = GM_getValue('tgq', []);
    q.push({ text: text.slice(0, 3900), silent });
    GM_setValue('tgq', q.slice(-60));
    flush();
  }

  function flush() {
    const tok = GM_getValue('tgToken'), chat = GM_getValue('tgChat');
    if (!tok || !chat) return;
    if (Date.now() - GM_getValue('tgLock', 0) < 20000) return; // otra pestaña está enviando
    const q = GM_getValue('tgq', []);
    if (!q.length) return;
    GM_setValue('tgLock', Date.now());
    const m = q[0];
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://api.telegram.org/bot${tok}/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ chat_id: chat, text: m.text, disable_web_page_preview: true, disable_notification: !!m.silent }),
      timeout: 15000,
      onload: (r) => {
        GM_setValue('tgLock', 0);
        if (r.status === 200 || r.status === 400) { // 400 = mensaje inválido: descartarlo para no trabar la cola
          const q2 = GM_getValue('tgq', []); q2.shift(); GM_setValue('tgq', q2);
          setTimeout(flush, 1200);
        } else setTimeout(flush, 30000);
      },
      onerror: () => { GM_setValue('tgLock', 0); },
      ontimeout: () => { GM_setValue('tgLock', 0); },
    });
  }

  function alertOnce(key, text, hours) {
    const A = GM_getValue('alerts', {});
    if (Date.now() - (A[key] || 0) < hours * 36e5) return;
    A[key] = Date.now(); GM_setValue('alerts', A);
    stat('error', key);
    tg('⚠ ' + text, { silent: false });
  }

  function dailySummary() {
    if (hourNow() < CFG.summaryHour || GM_getValue('lastSummary') === today()) return;
    GM_setValue('lastSummary', today());
    const s = GM_getValue('stats', {});
    if (s.date !== today()) return;
    tg(`Resumen ${today()}: Upwork ${s.upwork || 0} páginas, Facebook ${s.facebook || 0}, otras webs ${s.general || 0}, consultas API ${s.apis || 0}; ${s.leads || 0} avisos.` +
       (s.errors && s.errors.length ? ` Incidencias: ${s.errors.join(', ')}.` : ' Sin incidencias.'), { silent: true });
  }

  /* ======================= ESCÁNER UPWORK ======================= */
  async function waitFor(fn, ms) {
    const t = Date.now();
    while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(1500); }
    return null;
  }

  async function scanUpwork(C) {
    if (/login|account-security/.test(location.pathname)) return { login: true };
    const tiles = await waitFor(() => {
      const t = [...document.querySelectorAll('article, section.air3-card-section')]
        .filter((x) => /Posted/.test(x.innerText) && /Proposals/.test(x.innerText));
      return t.length ? t : null;
    }, 45000);
    if (/just a moment|un momento/i.test(document.title)) return { cf: true };
    if (/login|account-security/.test(location.pathname)) return { login: true };
    if (!tiles) return { empty: true };

    const leads = [], keys = [];
    for (const t of tiles) {
      const x = clean(t.innerText);
      if (!/^.{0,40}Posted/.test(x)) continue;
      const a = t.querySelector('a[href*="/jobs/"]');
      const href = a ? a.href.split('?')[0] : '';
      const id = (href.match(/~0\w+/) || [x.slice(0, 50)])[0];
      const key = 'u:' + id;
      if (seenCheck(key) || keys.includes(key)) continue;
      const title = a ? clean(a.innerText) : '';

      const g = x.match(/Posted (\d+|an?|yesterday)\s*(minute|hour|day)?/i) || [];
      let m = 9e3;
      if (g[2]) { const v = /\d/.test(g[1]) ? +g[1] : 1; m = /min/i.test(g[2]) ? v : /hour/i.test(g[2]) ? v * 60 : v * 1440; }
      if (m > C.maxAgeMin) continue;

      const p = (x.match(/Proposals:\s*(Less than 5|Fewer than 5|\d+ to \d+|\d+\+)/i) || [])[1] || '?';
      const pm = /than 5/i.test(p) ? 4 : +((p.match(/to (\d+)/) || [])[1] || 99);
      const s = x.match(/\$([\d.]+)([KM]?)\+? spent/) || [];
      const sp = s[1] ? s[1] * (s[2] === 'M' ? 1e6 : s[2] === 'K' ? 1e3 : 1) : 0;
      const hr = x.match(/Hourly:?\s*\$([\d.]+)(?:\s*-\s*\$([\d.]+))?/) || [];
      const fx = (x.match(/Est\. budget:\s*\$([\d,.]+)/) || [])[1];
      const maxRate = hr[1] ? +(hr[2] || hr[1]) : null;
      const rateOK = hr[1] ? maxRate >= 25 : fx ? +fx.replace(/,/g, '') >= 200 : true;
      const pos = [...new Set((x.toLowerCase().match(UP_POS) || []))];
      const stackOK = pos.length >= 3 || (pos.length >= 2 && UP_CORE.test(title));
      // El título debe ser de desarrollo, no de marketing/ventas/diseño/asistencia.
      const devTitle = /(develop|engineer|programm|coder|full[- ]?stack|back[- ]?end|front[- ]?end|api|integrat|automat|build|bot\b|agent|saas|mvp|app\b|web app|platform|script|fix|debug|migrat|architect|technical|devops|database|scrap)/i.test(title);
      const nonDevTitle = /(assistant|\bva\b|virtual assistant|marketing|marketer|seo|google ads|ads specialist|link building|\bpr\b|outreach|sales|closer|affiliate|recruit|copywrit|writer|content|social media|designer|figma|ui\/ux|ux\/ui|video|editor|tutor|coach|bookkeep|accountant|customer (service|support)|answering|appointment setter|lead gen|data entry|\bea\b|mt[45]|forex|trading bot)/i.test(title);

      const why = [];
      if (!/Payment verified/.test(x)) why.push('sin_pago');
      if (!(pm <= 15 || (pm <= 20 && sp >= 5e4))) why.push('propuestas');
      if (!rateOK) why.push('tarifa');
      if (!stackOK) why.push('stack');
      if (!devTitle || nonDevTitle) why.push('titulo_no_dev');
      const neg = (x.match(UP_NEG) || [])[0];
      if (neg) why.push('excl:' + neg.toLowerCase());
      if (UP_SCAM.test(x)) why.push('estafa');
      diag('upwork', why, `${title.slice(0, 60)} | ${hr[1] ? '$' + (hr[2] || hr[1]) + '/h' : 'fijo $' + (fx || '?')} | ${p} | ${pos.length}st`);
      if (why.length) continue;

      const loc = (x.match(/Location\s+([A-Za-z .]+?)(?= Hourly| Fixed| Est| Intermediate| Expert| Entry|$)/) || [])[1] || '';
      const rating = (x.match(/Rating is ([\d.]+) out of 5/) || [])[1];
      const prio = pm <= 4 && m <= 30 && sp >= 1e4 && (maxRate === null || maxRate >= 40);
      keys.push(key);
      leads.push(
        `${prio ? '★ PRIORIDAD ' : ''}[UPWORK] ${m < 60 ? m + ' min' : Math.round(m / 60) + ' h'} · ${p} propuestas\n` +
        `${title}\n` +
        `${hr[1] ? '$' + hr[1] + (hr[2] ? '-' + hr[2] : '') + '/h' : 'Fijo $' + (fx || '?')} · ` +
        `${sp === 0 ? 'CLIENTE NUEVO ($0)' : 'gasto $' + (sp >= 1e3 ? Math.round(sp / 1e3) + 'K' : sp)}` +
        `${rating && sp > 0 ? ' · ★' + rating : ''}${loc ? ' · ' + loc : ''}\n` +
        `Stack: ${pos.slice(0, 7).join(', ')}\n` +
        (id.startsWith('~0') ? 'https://www.upwork.com/jobs/' + id : href)
      );
    }
    return { leads, keys, n: tiles.length };
  }

  /* ======================= ESCÁNER FACEBOOK ======================= */
  const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, set: 8, oct: 9, nov: 10, dic: 11, enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

  function fbAge(t) {
    let g = t.match(/(Hace|hace) (\d+|un|una) (minutos?|horas?|d[ií]as?|semanas?)/);
    if (g) {
      const v = /\d/.test(g[2]) ? +g[2] : 1;
      const h = /min/.test(g[3]) ? v / 60 : /hora/.test(g[3]) ? v : /sem/.test(g[3]) ? v * 168 : v * 24;
      return { h, idx: g.index, len: g[0].length };
    }
    g = t.slice(0, 160).match(/\s(\d+)\s?(min|h|d)\s/);
    if (g) {
      const v = +g[1];
      return { h: g[2] === 'min' ? v / 60 : g[2] === 'h' ? v : v * 24, idx: g.index, len: g[0].length };
    }
    g = t.slice(0, 200).match(/\s(Ayer)\b/);
    if (g) return { h: 24, idx: g.index, len: g[0].length };
    g = t.slice(0, 200).match(/\s(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept?|set|oct|nov|dic)\b/i);
    if (g) {
      const now = new Date();
      let d = new Date(now.getFullYear(), MESES[g[2].toLowerCase()], +g[1]);
      if (d > now) d = new Date(now.getFullYear() - 1, d.getMonth(), d.getDate());
      return { h: (now - d) / 36e5, idx: g.index, len: g[0].length };
    }
    return null;
  }

  async function scanFB(C, isSearch) {
    if (/\/login/.test(location.pathname) || document.querySelector('input[name="pass"]')) return { login: true };
    await sleep(4000);
    window.scrollTo(0, 0);
    const posts = new Map();
    const collect = () => {
      let nodes = [...document.querySelectorAll('div[aria-posinset]')];
      if (!nodes.length) nodes = [...document.querySelectorAll('div[role="article"]')].filter((a) => !a.parentElement.closest('div[role="article"]'));
      nodes.forEach((a) => {
        let t = a.innerText.normalize('NFKC').replace(/(Facebook\s*)+/g, ' ').replace(/[͏​]/g, '').replace(/\s+/g, ' ').replace(/(?:\S ){6,}\S?/g, ' ').trim();
        if (t.length < 25) return;
        const c = t.search(/Comentas como|Responde como|Todas las reacciones|Me gusta Comentar/);
        if (c > 0) t = t.slice(0, c);
        // Texto que Facebook reconoce dentro de imágenes ("Puede ser una imagen de texto que dice '...'")
        const img = [...a.querySelectorAll('img[alt]')].map((i) => i.alt).filter((s) => /dice|says/i.test(s)).join(' ').slice(0, 600);
        const link = [...a.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')].map((l) => l.href.split('?')[0])[0] || '';
        posts.set(t.slice(0, 60), { t, img, link });
      });
    };
    // Expande "Ver más" para que los filtros lean el texto completo y no solo la vista previa
    const expand = async () => {
      let k = 0;
      document.querySelectorAll('div[aria-posinset] div[role="button"], div[role="article"] div[role="button"]').forEach((b) => {
        if (k < 8 && /^(Ver más|See more)$/.test(b.innerText.trim())) { b.click(); k++; }
      });
      if (k) await sleep(700);
    };
    for (let i = 0; i < C.scrolls; i++) { await expand(); collect(); window.scrollBy(0, 1400); await sleep(1500); }
    await expand();
    collect();
    if (posts.size <= 3) return { frozen: true, n: posts.size };

    const group = clean(document.title.replace(/\(\d+\)|\| Facebook/g, ''));
    const maxH = isSearch ? C.maxAgeHSearch : C.maxAgeHFeed;
    const leads = [], keys = [];
    for (const { t, img, link } of posts.values()) {
      const age = fbAge(t);
      if (!age || age.h > maxH) continue;
      const key = 'f:' + t.slice(0, 45);
      if (seenCheck(key) || keys.includes(key)) continue;
      const auth = t.slice(0, age.idx).replace(/ · Seguir/, '').trim().slice(-40);
      const body = t.slice(age.idx + age.len).replace(/^[^·]*·\s*/, '');
      const ageTxt = age.h < 1 ? Math.round(age.h * 60) + ' min' : Math.round(age.h) + ' h';
      const xm = (body.slice(0, 350).match(FB_X) || [])[0];
      const full = body + ' ' + img;            // incluye el texto leído en la imagen
      const b = FB_B.test(full), tt = FB_T.test(full);
      const xi = !xm && img ? (img.match(FB_X) || [])[0] : null;
      const why = xm ? ['excl:' + xm.toLowerCase()] : xi ? ['excl_img:' + xi.toLowerCase()] : b && tt ? [] : [!b && !tt ? 'sin_pedido_ni_tema' : !b ? 'sin_pedido' : 'sin_tema'];
      diag('facebook', why, `${group.slice(0, 25)} | ${body.slice(0, 70)}${img ? ' [img] ' + img.slice(0, 40) : ''}`);
      if (why.length) continue;
      keys.push(key);
      const viaImg = !(FB_B.test(body) && FB_T.test(body));
      leads.push(`[FACEBOOK${viaImg ? ' · texto en imagen' : ''}] ${group} · ${ageTxt}\n${auth}\n${body.slice(0, 300)}${viaImg ? '\nImagen: ' + img.slice(0, 250) : ''}\n${link || location.href.split('?')[0]}`);
    }
    return { leads, keys, n: posts.size };
  }

  /* ======================= CICLO ======================= */
  function fbPageCount() { return CFG.facebook.feeds.length + CFG.facebook.searchesPerCycle; }
  function fbUrl(i) {
    const C = CFG.facebook;
    if (i < C.feeds.length) return { url: C.feeds[i], search: false };
    const all = [];
    // v1.5.0: solo búsqueda global; la búsqueda dentro de grupos ignora el filtro de recientes
    C.globalTerms.forEach((q) => all.push(`https://www.facebook.com/search/posts/?q=${encodeURIComponent(q)}${FB_RECENT}`));
    const k = (GM_getValue('fbSearchIdx', 0) + (i - C.feeds.length)) % all.length;
    return { url: all[k], search: true };
  }
  const pageCount = () => (host === 'upwork' ? CFG.upwork.pages.length : fbPageCount());
  const pageUrl = (i) => (host === 'upwork' ? CFG.upwork.pages[i] : fbUrl(i).url);

  let badge;
  // Vigilante: si la pestaña quedó congelada/suspendida y pasó la hora prevista, recarga para seguir.
  let dueAt = 0, CURMODE = null, CURID = null;
  const FORCE = /zscan|zgen/.test(location.hash);   // inicio explícito por enlace: toma el relevo
  const START = {
    upwork: 'https://www.upwork.com/nx/find-work/best-matches#zscan',
    facebook: 'https://www.facebook.com/groups/1025454714150122/?sorting_setting=CHRONOLOGICAL#zscan',
    general: 'https://www.workana.com/jobs?category=it-programming#zgen',
  };
  const newId = () => Math.random().toString(36).slice(2, 10);
  // Latido: cada pestaña anota hasta cuándo debería volver a dar señales. Si se pasa 15 min, se la considera muerta.
  function beat(until) {
    if (!CURMODE) return;
    const H = GM_getValue('hb', {});
    H[CURMODE] = { id: CURID, t: until };
    GM_setValue('hb', H);
  }
  const due = (ms) => { dueAt = Date.now() + ms; beat(dueAt); };
  // Si otra pestaña del mismo tipo está viva (p. ej. una reabierta), esta cede para no duplicar.
  function otherAlive(mode, id) {
    const h = GM_getValue('hb', {})[mode];
    return !!(h && h.id !== id && Date.now() < h.t + 15 * 60e3);
  }
  function setEnabled(mode, on) { const E = GM_getValue('enabled', {}); E[mode] = on; GM_setValue('enabled', E); }
  // Autocuración: si una pestaña del escáner está muerta (cerrada, descartada por Chrome, congelada), abre otra.
  function heal() {
    const h0 = hourNow();
    if (h0 < CFG.activeFrom + 0.25 || h0 >= CFG.activeTo) return;
    const E = GM_getValue('enabled', {}), H = GM_getValue('hb', {});
    for (const m of Object.keys(START)) {
      if (!E[m] || m === CURMODE) continue;
      const h = H[m];
      if (h && Date.now() < h.t + 15 * 60e3) continue;
      const L = GM_getValue('healLock', {});
      if (Date.now() - (L[m] || 0) < 20 * 60e3) continue;
      L[m] = Date.now(); GM_setValue('healLock', L);
      const gap = h ? Math.round((Date.now() - h.t) / 6e4) : null;
      diagErr('reabierta:' + m);
      tg(`Escáner: la pestaña ${m} estaba detenida${gap ? ' ~' + gap + ' min' : ''}; abrí una nueva automáticamente.`, { silent: true });
      GM_openInTab(START[m], { active: false, insert: true });
    }
  }
  function watchdog() {
    const check = () => { if (dueAt && Date.now() > dueAt + 3 * 60e3) { dueAt = 0; location.reload(); return; } heal(); };
    setInterval(check, 60e3);
    document.addEventListener('visibilitychange', check);
    document.addEventListener('resume', check);
    window.addEventListener('focus', check);
  }
  function showBadge(text) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#111;color:#fff;font:12px/1.4 system-ui;padding:6px 10px;border-radius:6px;opacity:.85';
      const stop = document.createElement('button');
      stop.textContent = 'Detener';
      stop.style.cssText = 'margin-left:8px;font:inherit;cursor:pointer';
      stop.onclick = stopScan;
      badge.append(document.createElement('span'), stop);
      document.body.appendChild(badge);
    }
    badge.firstChild.textContent = 'Lead Scanner: ' + text;
  }

  function goNext(i, delay, label) {
    const next = (i + 1) % pageCount();
    const at = new Date(Date.now() + delay);
    showBadge(`${label} · siguiente ${at.toLocaleTimeString().slice(0, 5)}`);
    due(delay);
    setTimeout(() => {
      if (sessionStorage.zscan !== host) return;
      if (host === 'facebook' && next === 0) GM_setValue('fbSearchIdx', GM_getValue('fbSearchIdx', 0) + CFG.facebook.searchesPerCycle);
      sessionStorage.zidx = next;
      location.assign(pageUrl(next));
    }, delay);
  }

  function retrySame(i, delay, label) {
    showBadge(label);
    due(delay);
    setTimeout(() => { if (sessionStorage.zscan === host) location.assign(pageUrl(i)); }, delay);
  }

  async function run() {
    CURMODE = host;
    if (!sessionStorage.zid) sessionStorage.zid = newId();
    CURID = sessionStorage.zid;
    if (!FORCE && otherAlive(host, CURID)) { delete sessionStorage.zscan; showBadge('detenido: otra pestaña tomó el relevo'); return; }
    const prev = (GM_getValue('hb', {})[host] || {});
    if (prev.id === CURID && Date.now() > prev.t + 15 * 60e3) diagErr(host + ':pausa_' + Math.round((Date.now() - prev.t) / 36e5) + 'h');
    due(5 * 60e3);
    flush();
    dailySummary();
    weeklyReport();
    await runApis();
    const i = +(sessionStorage.zidx || 0) % pageCount();

    const h = hourNow();
    if (h < CFG.activeFrom || h >= CFG.activeTo) {
      const wake = new Date(); wake.setHours(CFG.activeFrom, 5, 0, 0);
      if (wake < new Date()) wake.setDate(wake.getDate() + 1);
      showBadge('en pausa nocturna');
      due(wake - new Date());
      setTimeout(() => location.assign(pageUrl(i)), wake - new Date());
      return;
    }

    // Si la pestaña no está en una página de escaneo (p. ej. tras iniciar sesión), volver a la lista.
    const onScanPage = host === 'upwork' ? /\/nx\/(search\/jobs|find-work)/.test(location.pathname) || /just a moment/i.test(document.title)
                                         : /\/groups\/|\/search\/posts/.test(location.pathname);
    if (!onScanPage && !/login|account-security/.test(location.pathname)) { location.assign(pageUrl(i)); return; }

    showBadge(`escaneando ${i + 1}/${pageCount()}…`);
    due(4 * 60e3);
    let r;
    try {
      r = host === 'upwork' ? await scanUpwork(CFG.upwork) : await scanFB(CFG.facebook, fbUrl(i).search);
    } catch (e) { r = { error: e.message }; }

    const fails = +(sessionStorage.zfail || 0);
    const errType = r.login ? 'login' : r.cf ? 'cloudflare' : r.empty ? 'sin_ofertas' : r.frozen ? 'fb_congelado' : r.error ? 'js:' + r.error.slice(0, 40) : '';
    if (errType) diagErr(host + ':' + errType);
    diagMirror();
    if (r.login) {
      alertOnce('login_' + host, `${host}: sesión cerrada. Inicia sesión en la pestaña del escáner; seguirá solo.`, 6);
      return retrySame(i, 10 * 60e3, 'sesión cerrada, reintento en 10 min');
    }
    if (r.cf || r.empty || r.frozen || r.error) {
      sessionStorage.zfail = fails + 1;
      if (fails + 1 >= 3) {
        sessionStorage.zfail = 0;
        const msg = r.cf ? 'Upwork: Cloudflare está bloqueando la página.'
          : r.frozen ? 'Facebook: la pestaña no carga publicaciones (¿ventana minimizada o ahorro de memoria activo?).'
          : r.empty ? 'Upwork: no encuentro ofertas en la página (posible cambio de diseño).'
          : `${host}: error del script (${r.error}).`;
        alertOnce('fail_' + host + (r.cf ? 'cf' : r.frozen ? 'fz' : r.empty ? 'em' : 'js'), msg + ' Pauso 30 min.', 6);
        return goNext(i, 30 * 60e3, 'pausa por errores');
      }
      return retrySame(i, jitter(25e3), 'reintentando…');
    }
    sessionStorage.zfail = 0;

    stat(host);
    if (r.leads.length) {
      stat('leads', r.leads.length);
      r.leads.forEach((l) => tg(l));
      seenAdd(r.keys);
    }
    const label = `${r.leads.length} nuevo(s) de ${r.n}`;

    if (host === 'upwork') return goNext(i, jitter(CFG.upwork.dwellMin * 60e3), label);
    // Facebook: espera corta entre páginas; al cerrar el ciclo, espera el resto del ciclo.
    if (i === 0) sessionStorage.zcycle = Date.now() - 30e3;
    const last = i === fbPageCount() - 1;
    const rest = CFG.facebook.cycleMin * 60e3 - (Date.now() - +(sessionStorage.zcycle || Date.now()));
    return goNext(i, last ? Math.max(jitter(60e3), rest) : jitter(70e3), label);
  }

  /* ======================= BOLSAS REMOTAS (API / RSS) ======================= */
  const toMs = (d) => (typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : /^\d+$/.test(d || '') ? toMs(+d) : Date.parse(d));
  const APIS = [
    { name: 'RemoteOK', url: 'https://remoteok.com/api',
      parse: (j) => j.filter((x) => x && x.position).map((x) => ({ id: x.id, title: x.position, co: x.company, loc: x.location, text: (x.tags || []).join(' '), url: x.url, date: x.date || x.epoch, sal: x.salary_min ? `$${x.salary_min}-${x.salary_max}/año` : '' })) },
    { name: 'Remotive', url: 'https://remotive.com/api/remote-jobs?category=software-dev&limit=100',
      parse: (j) => (j.jobs || []).map((x) => ({ id: x.id, title: x.title, co: x.company_name, loc: x.candidate_required_location, text: (x.tags || []).join(' '), url: x.url, date: x.publication_date, sal: x.salary })) },
    { name: 'Himalayas', url: 'https://himalayas.app/jobs/api?limit=100',
      parse: (j) => (j.jobs || []).map((x) => ({ id: x.guid || x.applicationLink, title: x.title, co: x.companyName, loc: (x.locationRestrictions || []).join(', '), text: [(x.categories || []).join(' '), x.excerpt || ''].join(' '), url: x.applicationLink || x.guid, date: x.pubDate, sal: x.minSalary ? `$${x.minSalary}-${x.maxSalary}` : '' })) },
    { name: 'Jobicy', url: 'https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev',
      parse: (j) => (j.jobs || []).map((x) => ({ id: x.id, title: x.jobTitle, co: x.companyName, loc: x.jobGeo, text: x.jobExcerpt || '', url: x.url, date: x.pubDate, sal: x.annualSalaryMin ? `$${x.annualSalaryMin}-${x.annualSalaryMax}/año` : '' })) },
    { name: 'WorkingNomads', url: 'https://www.workingnomads.com/api/exposed_jobs/',
      parse: (j) => (Array.isArray(j) ? j : []).filter((x) => /develop/i.test(x.category_name || 'develop')).map((x) => ({ id: x.url, title: x.title, co: x.company_name, loc: x.location, text: x.tags || '', url: x.url, date: x.pub_date })) },
    { name: 'WWR full-stack', url: 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', rss: true },
    { name: 'WWR back-end', url: 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', rss: true },
    { name: 'HN Who is hiring', custom: hnJobs },
  ];

  function gmJson(method, url, body) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url, timeout: 20000, data: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      onload: (r) => { if (r.status !== 200) return reject('http ' + r.status); try { resolve(JSON.parse(r.responseText)); } catch (e) { reject('parse'); } },
      onerror: () => reject('red'), ontimeout: () => reject('timeout'),
    }));
  }

  async function torreJobs() {
    const out = [];
    for (const skill of ['node.js', 'typescript', 'python', 'nestjs']) {
      const j = await gmJson('POST', 'https://search.torre.co/opportunities/_search/?currency=USD%24&periodicity=hourly&lang=es&size=30&aggregate=false&offset=0',
        { and: [{ 'skill/role': { text: skill, experience: 'potential-to-develop' } }, { remote: { term: true } }] });
      (j.results || []).forEach((x) => {
        const c = x.compensation && x.compensation.data;
        out.push({ id: x.id, title: x.objective || '', co: ((x.organizations || [])[0] || {}).name || '',
          loc: (x.locations || []).join(', ') || (x.remote ? 'Remote' : ''), text: (x.skills || []).map((s) => s.name).join(' '),
          url: 'https://torre.ai/post/' + x.id, date: x.created,
          sal: c && c.minAmount ? `${c.currency || ''} ${c.minAmount}-${c.maxAmount || ''}/${c.periodicity || ''}` : '' });
      });
    }
    return out;
  }

  async function hnJobs() {
    const st = await gmJson('GET', 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=3');
    const story = (st.hits || []).find((h) => /who is hiring/i.test(h.title));
    if (!story) return [];
    const since = Math.floor(Date.now() / 1000) - 3 * 86400;
    const j = await gmJson('GET', `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${story.objectID}&hitsPerPage=200&numericFilters=created_at_i>${since}`);
    return (j.hits || []).filter((h) => (!h.parent_id || String(h.parent_id) === String(story.objectID)) && !/^\s*(seeking (work|freelance)|available|for hire)/i.test((h.comment_text || '').replace(/<[^>]+>/g, ' '))).map((h) => {
      const txt = (h.comment_text || '').replace(/<[^>]+>/g, ' ').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
      const first = txt.split(/\n| \| /).slice(0, 4).join(' | ').slice(0, 140);
      const remote = /remote/i.test(txt);
      return { id: h.objectID, title: first, co: 'HN', loc: remote ? (/(us|usa|u\.s\.)[- ]only|remote \(us|us remote|remote us/i.test(txt) ? 'USA only' : 'Remote') : 'onsite',
        text: txt.slice(0, 1500), url: 'https://news.ycombinator.com/item?id=' + h.objectID, date: h.created_at_i };
    });
  }

  function fetchApi(a) {
    if (a.custom) return a.custom();
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET', url: a.url, timeout: 20000, headers: { Accept: a.rss ? 'application/rss+xml' : 'application/json' },
      onload: (r) => {
        if (r.status !== 200) return reject('http ' + r.status);
        try {
          if (a.rss) {
            const x = new DOMParser().parseFromString(r.responseText, 'text/xml');
            return resolve([...x.querySelectorAll('item')].map((it) => {
              const g = (s) => (it.querySelector(s) || {}).textContent || '';
              return { id: g('guid') || g('link'), title: g('title'), co: '', loc: g('region'), text: g('description').replace(/<[^>]+>/g, ' ').slice(0, 1500), url: g('link'), date: g('pubDate') };
            }));
          }
          resolve(a.parse(JSON.parse(r.responseText)));
        } catch (e) { reject('parse'); }
      },
      onerror: () => reject('red'), ontimeout: () => reject('timeout'),
    }));
  }

  function apiWhy(j, project) {
    if (project) return genWhy('project', j.title, j.text);
    const w = [];
    if (!JOB_TITLE.test(j.title) && !(j.co === 'HN' && /(node|typescript|python|full.?stack|backend)/i.test(j.text || ''))) w.push('titulo');
    const n = (j.title.toLowerCase().match(JOB_NEG) || [])[0];
    if (n) w.push('excl:' + n);
    if (!locOK(j.loc) || LOC_BAD.test(j.title + ' ' + (j.loc || ''))) w.push('ubicacion');
    return w;
  }

  async function runApis() {
    if (Date.now() - GM_getValue('apiLast', 0) < CFG.apis.everyMin * 60e3) return;
    GM_setValue('apiLast', Date.now());
    const W = GM_getValue('warm', {});
    const leads = [], keys = [];
    const res = await Promise.all(APIS.map((a) => fetchApi(a).then((items) => ({ a, items }), (err) => ({ a, err }))));
    for (const { a, items, err } of res) {
      if (err) { diagErr('api:' + a.name + ':' + err); continue; }
      const first = !W['api:' + a.name];
      const maxH = first ? CFG.apis.firstRunMaxAgeH : CFG.apis.maxAgeH;
      for (const j of items) {
        if (!j.title || !j.url) continue;
        const key = 'a:' + a.name + ':' + (j.id || j.url);
        if (seenCheck(key) || keys.includes(key)) continue;
        const ms = j.date ? toMs(j.date) : NaN;
        if (!isNaN(ms) && (Date.now() - ms) / 36e5 > maxH) continue;
        const why = apiWhy(j, a.project);
        diag('apis', why, `${a.name} | ${j.title.slice(0, 60)} | ${(j.loc || '').slice(0, 30)}`);
        if (why.length) continue;
        keys.push(key);
        leads.push(`• ${clean(j.title).slice(0, 90)}${j.co ? ' — ' + j.co : ''}\n  ${[j.loc, j.sal, a.name].filter(Boolean).join(' · ')}\n  ${j.url}`);
      }
      W['api:' + a.name] = W['api:' + a.name] || Date.now();
    }
    GM_setValue('warm', W);
    stat('apis');
    if (leads.length) {
      seenAdd(keys);
      stat('leads', leads.length);
      for (let k = 0; k < leads.length; k += 8) tg(`[BOLSAS REMOTAS] ${leads.length} nueva(s)\n\n` + leads.slice(k, k + 8).join('\n\n'));
    }
  }

  /* ======================= PESTAÑA GENERAL (otras webs) ======================= */
  const getTab = () => new Promise((r) => GM_getTab((t) => r(t || {})));

  function extractCards(re) {
    const norm = (u) => { const m = u.match(/currentJobId=(\d+)/); return m ? 'https://www.linkedin.com/jobs/view/' + m[1] + '/' : u.split('?')[0].split('#')[0]; };
    const map = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      const h = norm(a.href);
      if (!re.test(h) || map.has(h)) continue;
      let c = a;
      while (c.parentElement && c.parentElement !== document.body) {
        const p = c.parentElement;
        const other = [...p.querySelectorAll('a[href]')].some((x) => { const hx = norm(x.href); return hx !== h && re.test(hx); });
        if (other) break;
        c = p;
        if (c.innerText.length > 1500) break;
      }
      const t = clean(c.innerText).slice(0, 1500);
      let title = clean(a.innerText);
      if (title.length < 6) title = t.slice(0, 90);
      map.set(h, { h, title, t });
    }
    // LinkedIn (interfaz nueva): las tarjetas no tienen enlace propio; el id viene en componentkey.
    if (location.hostname.includes('linkedin')) {
      document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach((el) => {
        const id = el.getAttribute('componentkey').replace(/\D/g, '');
        const h = 'https://www.linkedin.com/jobs/view/' + id + '/';
        if (!id || map.has(h)) return;
        const t = clean(el.innerText || '').replace(/\(Empleo verificado\)|Seleccionado,/gi, '').slice(0, 800);
        if (t.length > 15) map.set(h, { h, title: t.slice(0, 90), t });
      });
    }
    return [...map.values()];
  }

  function extractPosts() {
    const map = new Map();
    document.querySelectorAll('[data-urn*="activity"], [data-id*="activity"]').forEach((el) => {
      const urn = el.getAttribute('data-urn') || el.getAttribute('data-id');
      if (map.has(urn) || el.parentElement.closest('[data-urn*="activity"]')) return;
      const t = clean(el.innerText).replace(/…\s*(ver más|see more|más)/gi, ' ').slice(0, 1500);
      if (t.length < 40) return;
      map.set(urn, { h: 'https://www.linkedin.com/feed/update/' + urn + '/', title: t.slice(0, 90), t });
    });
    return [...map.values()];
  }

  const HIRE = /(busc(o|amos|a)\b|necesit|requier|contrat|se busca|vacante|we('re| are) hiring|\bhiring\b|looking for (a |an )?([a-z-]+ )?(developer|engineer|freelancer|dev\b)|seeking (a |an )?([a-z-]+ )?(developer|engineer)|need (a |an )?([a-z-]+ )?(developer|engineer))/i;
  const SELF = /(#?open ?to ?work|estoy buscando (empleo|trabajo|oportunidad)|busco (empleo|trabajo|oportunidad|nuevos retos|nuevas oportunidades)|i'm looking for (a )?(new )?(job|role|opportunit)|available for (hire|work|freelance)|disponible para|mi portafolio|my portfolio|ofrezco|ofrecemos)/i;

  function genWhy(kind, title, t) {
    const w = [];
    const low = (title + ' ' + t).toLowerCase();
    if (kind === 'posts') {
      if (!HIRE.test(t)) w.push('sin_pedido');
      const pos = [...new Set(low.match(GEN_POS) || [])];
      if (pos.length < 1 && !FB_T.test(t)) w.push('sin_tema');
      const sx = (t.slice(0, 400).match(SELF) || [])[0];
      if (sx) w.push('autopromo');
      const n = (low.match(PROJ_NEG) || [])[0];
      if (n) w.push('excl:' + n);
      return w;
    }
    if (kind === 'project') {
      const pos = [...new Set(low.match(GEN_POS) || [])];
      if (pos.length < 2 && !JOB_TITLE.test(title)) w.push('stack');
      // Excluir solo si la tecnología ajena está en el título, o si en el texto no hay nada de tu stack principal.
      const n = (title.toLowerCase().match(PROJ_NEG) || [])[0] || (!/(node|nest|next|typescript|python|fastapi|react|postgres|\bia\b|\bai\b|llm|chatbot|whatsapp|api)/i.test(t) ? (low.match(PROJ_NEG) || [])[0] : null);
      if (n) w.push('excl:' + n);
    } else {
      if (!JOB_TITLE.test(title)) w.push('titulo');
      const n = (title.toLowerCase().match(JOB_NEG) || [])[0];
      if (n) w.push('excl:' + n);
      if (kind === 'local' && !/(remoto|teletrabajo|home office|trabajo desde casa|tacna)/i.test(t)) w.push('no_remoto');
      if (kind === 'job' && LOC_BAD.test(t)) w.push('ubicacion');
    }
    return w;
  }

  const extraInfo = (t) => [
    (t.match(/(US\$|USD|\$|S\/\.?)\s?[\d.,]+(\s?(-|a)\s?(US\$|USD|\$|S\/\.?)?\s?[\d.,]+)?(\s?(\/|por|per)\s?\w+)?/i) || [])[0],
    (t.match(/\b(remoto|remote|teletrabajo|h[ií]brido|hybrid|presencial)\b/i) || [])[0],
    (t.match(/\b(hace \d+ \w+|\d+ (hours?|days?|minutes?) ago|publicado [^.]{0,20})/i) || [])[0],
  ].filter(Boolean).join(' · ');

  async function scanGeneric(src) {
    if (/login|authwall|checkpoint|signin|uas\/login/i.test(location.pathname)) return { login: true };
    await sleep(5000);
    for (let k = 0; k < 4; k++) { window.scrollBy(0, 1500); await sleep(1200); }
    document.querySelectorAll('.jobs-search-results-list, .scaffold-layout__list, .scaffold-layout__list > div').forEach((el) => { el.scrollTop = el.scrollHeight; });
    await sleep(2500);
    const cards = src.kind === 'posts' ? extractPosts() : extractCards(src.link);
    if (!cards.length) return { empty: true };
    const W = GM_getValue('warm', {});
    const warm = !W['g:' + src.name];
    const leads = [], keys = [];
    for (const c of cards) {
      const key = 'g:' + c.h;
      if (seenCheck(key) || keys.includes(key)) continue;
      const age = src.kind === 'posts' ? fbAge(' ' + c.t) : null;
      if (age && age.h > 48) continue;
      const why = genWhy(src.kind, c.title, c.t);
      diag('general', why, `${src.name} | ${c.title.slice(0, 60)}`);
      if (warm) { keys.push(key); continue; }   // primera vez: solo memoriza, no avisa (evita aluvión)
      if (why.length) continue;
      keys.push(key);
      leads.push(`• ${c.title.slice(0, 100)}\n  ${extraInfo(c.t)}\n  ${c.h}`);
    }
    if (warm) { W['g:' + src.name] = Date.now(); GM_setValue('warm', W); }
    return { leads, keys, n: cards.length, warm };
  }

  async function runGeneral(tab) {
    CURMODE = 'general';
    if (!tab.zid) { tab.zid = newId(); GM_saveTab(tab); }
    CURID = tab.zid;
    if (!FORCE && otherAlive('general', CURID)) { tab.zgen = false; GM_saveTab(tab); showBadge('detenido: otra pestaña tomó el relevo'); return; }
    due(5 * 60e3);
    flush(); dailySummary(); weeklyReport();
    await runApis();
    const G = CFG.general, n = G.sources.length;
    const i = (tab.gi || 0) % n, src = G.sources[i];
    const next = () => { tab.gi = (i + 1) % n; tab.gfail = 0; GM_saveTab(tab); return G.sources[tab.gi].url; };

    const h = hourNow();
    if (h < CFG.activeFrom || h >= CFG.activeTo) {
      const wake = new Date(); wake.setHours(CFG.activeFrom, 10, 0, 0);
      if (wake < new Date()) wake.setDate(wake.getDate() + 1);
      showBadge('general en pausa nocturna');
      due(wake - new Date());
      setTimeout(() => location.assign(src.url), wake - new Date());
      return;
    }
    if (location.hostname !== new URL(src.url).hostname) { location.assign(src.url); return; }

    showBadge(`general: ${src.name} (${i + 1}/${n})…`);
    due(4 * 60e3);
    let r;
    try { r = await scanGeneric(src); } catch (e) { r = { error: e.message }; }
    diagMirrorAny();
    if (r.login || r.empty || r.error) {
      const type = r.login ? 'login' : r.empty ? 'sin_resultados' : 'js:' + r.error.slice(0, 40);
      diagErr('general:' + src.name + ':' + type);
      tab.gfail = (tab.gfail || 0) + 1; GM_saveTab(tab);
      if (r.login) alertOnce('glogin_' + src.name, `${src.name}: pide iniciar sesión. Inicia sesión en la pestaña general; el escáner sigue con las demás fuentes.`, 24);
      else if (tab.gfail >= 2) alertOnce('gempty_' + src.name, `${src.name}: no encuentro ofertas (posible cambio de diseño o bloqueo). Lo reviso en el afinado semanal.`, 24);
      if (tab.gfail < 2 && !r.login) { showBadge(`general: reintentando ${src.name}`); setTimeout(() => location.reload(), jitter(30e3)); return; }
      const u = next(); setTimeout(() => location.assign(u), jitter(20e3)); return;
    }
    stat('general');
    if (r.leads.length) {
      stat('leads', r.leads.length);
      tg(`[${src.name.toUpperCase()}] ${r.leads.length} nueva(s)\n\n` + r.leads.slice(0, 10).join('\n\n'));
      seenAdd(r.keys);
    } else if (r.warm) seenAdd(r.keys);
    const u = next();
    const delay = jitter(G.dwellMin * 60e3);
    showBadge(`general: ${src.name} ${r.warm ? 'memorizado (1ª vez)' : r.leads.length + ' nuevo(s)'} de ${r.n} · siguiente ${new Date(Date.now() + delay).toLocaleTimeString().slice(0, 5)}`);
    due(delay);
    setTimeout(async () => { const t = await getTab(); if (t.zgen) location.assign(u); }, delay);
  }

  function diagMirrorAny() { // si esta pestaña no es Upwork, guarda copia en GM para que la pestaña de Upwork la publique
    diagMirror();
  }

  async function startGeneral() {
    const t = await getTab();
    t.zgen = true; t.gi = 0; t.gfail = 0; t.zid = newId();
    GM_saveTab(t); setEnabled('general', true);
    location.assign(CFG.general.sources[0].url);
  }

  /* ======================= MENÚ ======================= */
  function startScan() {
    setEnabled(host, true); delete sessionStorage.zid;
    sessionStorage.zscan = host; sessionStorage.zidx = 0; sessionStorage.zfail = 0;
    location.assign(pageUrl(0));
  }
  function stopScan() {
    if (CURMODE) setEnabled(CURMODE, false);
    delete sessionStorage.zscan;
    getTab().then((t) => { t.zgen = false; GM_saveTab(t); });
    if (badge) badge.remove();
    badge = null;
  }

  function setupTelegram() {
    const tok = prompt('Pega el token de tu bot (te lo da @BotFather):', GM_getValue('tgToken', ''));
    if (!tok) return;
    GM_setValue('tgToken', tok.trim());
    alert('Ahora abre tu bot en Telegram y envíale /start. Cuando lo hayas hecho, pulsa Aceptar.');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://api.telegram.org/bot${tok.trim()}/getUpdates`,
      onload: (r) => {
        try {
          const j = JSON.parse(r.responseText);
          if (!j.ok) return alert('Token inválido: ' + (j.description || r.status));
          const u = (j.result || []).reverse().find((x) => x.message && x.message.chat);
          if (!u) return alert('No encontré tu /start. Envíalo al bot y vuelve a configurar.');
          GM_setValue('tgChat', u.message.chat.id);
          tg('Lead Scanner conectado. Aquí llegarán los avisos.', { silent: false });
          alert('Listo. Debería llegarte un mensaje de prueba.');
        } catch (e) { alert('Error leyendo la respuesta de Telegram.'); }
      },
    });
  }

  function showStatus() {
    const s = GM_getValue('stats', {});
    alert(`Hoy (${s.date || '-'}): Upwork ${s.upwork || 0} páginas, Facebook ${s.facebook || 0} páginas, ${s.leads || 0} avisos.\n` +
      `Incidencias: ${(s.errors || []).join(', ') || 'ninguna'}\nCola Telegram: ${GM_getValue('tgq', []).length}\n` +
      `Telegram configurado: ${GM_getValue('tgChat') ? 'sí' : 'no'}\nEsta pestaña escaneando: ${sessionStorage.zscan === host ? 'sí' : 'no'}`);
  }

  if (window.__ZTEST) { window.__Z = { scanUpwork, scanFB, fbAge, CFG, extractCards, genWhy, apiWhy, APIS, locOK, extraInfo }; return; }

  GM_registerMenuCommand(host === 'other' ? 'Iniciar escaneo GENERAL en esta pestaña' : `Iniciar escaneo ${host} en esta pestaña`, host === 'other' ? startGeneral : startScan);
  GM_registerMenuCommand('Iniciar escaneo GENERAL (Workana, LinkedIn, etc.) en esta pestaña', startGeneral);
  GM_registerMenuCommand('Detener escaneo en esta pestaña', stopScan);
  GM_registerMenuCommand('Abrir escáner completo (3 pestañas)', () => { Object.values(START).forEach((u) => GM_openInTab(u, { active: false, insert: true })); });
  GM_registerMenuCommand('Configurar Telegram', setupTelegram);
  GM_registerMenuCommand('Probar Telegram', () => tg('Prueba de Lead Scanner ✔', { silent: false }));
  GM_registerMenuCommand('Ver estado', showStatus);
  GM_registerMenuCommand('Copiar diagnóstico (para Claude)', () => {
    GM_setClipboard(JSON.stringify(diagExport(), null, 1), 'text');
    alert('Diagnóstico copiado. Pégalo en el chat con Claude.');
  });
  GM_registerMenuCommand('Olvidar avisos enviados (reset)', () => { if (confirm('¿Borrar el historial de avisos?')) GM_setValue('seen', {}); });

  if (location.hash.includes('zscan') && host !== 'other') { if (sessionStorage.zscan !== host) { delete sessionStorage.zid; sessionStorage.zidx = 0; } sessionStorage.zscan = host; setEnabled(host, true); }
  if (location.hash.includes('zgen')) {   // arranque de la pestaña GENERAL por enlace (…#zgen)
    getTab().then((t) => { setEnabled('general', true); if (!t.zgen) { t.zgen = true; t.gi = 0; t.gfail = 0; t.zid = newId(); GM_saveTab(t); } history.replaceState(null, '', location.href.split('#')[0]); watchdog(); runGeneral(t); });
    return;
  }
  if (host !== 'other' && sessionStorage.zscan === host) { watchdog(); run(); }
  else getTab().then((t) => { if (t.zgen) { watchdog(); runGeneral(t); } else { flush(); setTimeout(heal, 15000); } });
})();
