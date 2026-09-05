// アプリ内 window カスタムイベント名。dispatch 側と listener 側で必ずこの定数を使う
// (文字列リテラル散在だと typo でサイレントに壊れるため)。
export const UNANSWERED_REFRESH_EVENT = 'lh:unanswered-refresh'
