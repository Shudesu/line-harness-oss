/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LIFF_ID: string;
  readonly VITE_BOT_BASIC_ID: string;
  readonly VITE_CALENDAR_CONNECTION_ID: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
