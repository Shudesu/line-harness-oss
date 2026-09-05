🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | **Español**

# L Harness

> ### **[Pruébalo gratis en LINE](https://shudesu.github.io/line-harness-oss/)** 👈

CRM completamente open source para Cuentas Oficiales de LINE. **Alternativa gratuita a los SaaS de CRM para LINE propietarios** (con precios desde ¥10,000–20,000/mes).
Funciona sobre el plan gratuito de Cloudflare. **Costo de servidor: $0/mes**. Operable al 100% desde Claude Code.

### ▶️ [Ver el tutorial en YouTube (~20 min)](https://youtu.be/DiRuGaeq1sM)

[![Haz clic para reproducir en YouTube — Guía de configuración de L Harness](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**Versión actual**: v0.13.2 ・ Licencia MIT ・ TypeScript / Cloudflare Workers + D1

---

## ¿Por qué L Harness?

| | SaaS propietario A | SaaS propietario B | **L Harness** |
|---|---|---|---|
| Costo mensual | ¥20,000+ | ¥10,000+ | **$0** |
| Mensajería por pasos | ✅ | ✅ | ✅ |
| Difusión segmentada | ✅ | ✅ | ✅ |
| Cambio de menú enriquecido | ✅ | ✅ | ✅ |
| Formularios (LIFF) | ✅ | ✅ | ✅ |
| Lead scoring | ✅ | ❌ | ✅ |
| Automatización IF-THEN | parcial | parcial | ✅ |
| API pública | ❌ | ❌ | **todas las funciones** |
| Integración con Claude Code (IA) | ❌ | ❌ | **MCP server incluido** |
| Detección de bloqueos y migración automática | ❌ | ❌ | **✅** |
| Multi-cuenta | contrato adicional | contrato adicional | **incluido** |
| Deduplicación de contactos | ❌ | ❌ | **✅** (entre cuentas, vía token de picture_url) |
| Código fuente | cerrado | cerrado | **MIT (este repositorio)** |

---

## Inicio rápido

### Configuración con un solo comando

```bash
npx create-line-harness
```

El CLI se encarga de todo:
- Autenticación con Cloudflare (`wrangler login`)
- Creación de la base de datos D1 + aplicación de schema y migraciones
- Despliegue del Worker y del panel de administración
- Registro de credenciales de la Cuenta Oficial de LINE
- Creación automática de la app LIFF
- Creación del usuario Owner inicial para el panel

Tarda unos 5 minutos. Al finalizar, el panel en `https://<your-name>-admin.pages.dev` está listo para operar.

### Requisitos

- Cuenta de Cloudflare (con el plan gratuito basta)
- Cuenta Oficial de LINE + canal Messaging API
- Node.js 22+ / pnpm

---

## Funcionalidades

### Mensajería
- **Escenarios por pasos** — control a nivel de minuto con `delay_minutes`, ramificación condicional, envío stealth
- **Difusiones** — a todos / por etiqueta / por segmento, inmediatas o programadas, con cola automática para 500+
- **Recordatorios** — envío en cuenta regresiva desde una fecha objetivo (3 días antes / 1 día antes / el día)
- **Plantillas** — personalización con `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}`
- **Enlaces con tracking** — conteo de clics → etiquetado automático → trigger de escenario

### CRM
- **Gestión de contactos** — registro automático por webhook, obtención de perfil, metadata personalizada
- **Etiquetas** — condiciones de envío y triggers de escenario
- **Lead scoring** — cálculo automático basado en comportamiento
- **Chat de operador** — respuesta directa 1:1 desde el panel
- **Inbox de conversaciones** — lista las conversaciones sin responder ordenadas por tiempo de inactividad (los envíos automáticos se excluyen)
- **Deduplicación de contactos** — etiqueta automáticamente al mismo usuario físico en varias cuentas vía token de `picture_url`

### Marketing
- **Menús enriquecidos** — cambio automático por usuario / etiqueta
- **Formularios (LIFF)** — formularios completados dentro de LINE, respuestas guardadas como metadata
- **Reservas de calendario** — sistema de booking integrado con Google Calendar vía LIFF
- **Gestión de staff** — roles Owner / Admin / Staff, claves de API individuales

### Seguimiento de afiliados (ASP)
- **Emisión self-serve de enlaces** — los afiliados generan sus propios enlaces LIFF de tracking sin intervención del administrador
- **Gestión de campañas** — comisión fija por campaña, varias campañas en paralelo
- **Tracking cronológico** — registra clic → alta como contacto → conversión en orden, atribución last-touch
- **Flujo de aprobación** — aprueba o rechaza las conversiones atribuidas para confirmar la comisión, con marcas de cuentas duplicadas para detectar posible fraude
- **Notificaciones push por LINE** — push automático al afiliado cuando se confirma la conversión
- Detalles: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

### Automatización
- **Reglas IF-THEN** — 7 tipos de triggers × 6 tipos de acciones
- **Auto-respuestas** — coincidencia exacta / parcial de palabras clave
- **Webhooks IN/OUT** — integración con Stripe, Slack, etc.
- **Reglas de notificación** — alertas condicionales
- **Timing de envío** — controlado por completo con `delay_minutes` y `scheduled_at` (en v0.13.2 se eliminaron todas las restricciones horarias del sistema; tú gestionas el timing operativamente)

### Multi-cuenta
- Gestiona **varias Cuentas Oficiales de LINE** desde un solo panel
- **Scope por cuenta** para escenarios, etiquetas y difusiones
- **Detección de bloqueos** → migración automática de contactos a la siguiente cuenta del pool
- **Pools de tráfico** — distribución automática entre varias cuentas

### Integración con IA
- **MCP server incluido** (`@line-harness/mcp-server`) — operación en lenguaje natural desde Claude Code
  - `list_conversations` / `get_conversation` — la IA monitorea conversaciones sin responder
  - `create_scenario` / `update_step` — deja que la IA diseñe escenarios
  - `broadcast` / `send_message` — los envíos requieren confirmación del usuario
- **SDK oficial** (`@line-harness/sdk`) — SDK TypeScript tipado, ESM + CJS, sin dependencias

### Soporte para app iOS
- **`GET /api/capabilities`** — endpoint de negociación de capacidad/versión para la app iOS (the-harness-ios)
- Disponible para los roles Owner / Admin / Staff

---

## Arquitectura

```
[ Plataforma LINE ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                                ⇅
                      [ Cloudflare Pages (Next.js 15) ]
                                ⇅
                      [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + receptor de webhooks, envío gestionado por cron
- **Web** (`apps/web`): panel Next.js 15 (19 secciones)
- **Packages**:
  - `@line-harness/sdk` — SDK TypeScript
  - `@line-harness/mcp-server` — MCP server para Claude Code
  - `create-line-harness` — CLI de configuración
  - `@line-harness/plugin-template` — plantilla de extensión por plugins
  - `@line-harness/db` — migraciones D1 + helpers
  - `@line-harness/line-sdk` — wrapper ligero de la API de LINE
  - `@line-harness/shared` — definiciones de tipos compartidas

---

## Recursos

- [Tutorial de configuración (video)](https://youtu.be/DiRuGaeq1sM)
- [Demo en vivo en LINE](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## Licencia

Licencia MIT. Libre para uso comercial, modificación y redistribución.

---

## Contribuciones

Issues y PRs son bienvenidos. Por favor envíalos a `Shudesu/line-harness-oss` (este repositorio).

---

> **L Harness** por [@Shudesu](https://github.com/Shudesu) — un CRM open source para LINE nativo de IA
