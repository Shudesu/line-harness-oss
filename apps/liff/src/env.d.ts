/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LIFF_ID: string
  readonly VITE_API_URL: string
  readonly VITE_CALENDAR_CONNECTION_ID: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
