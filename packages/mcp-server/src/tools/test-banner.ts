/**
 * isTest:true の Flex メッセージに「テスト配信」バナーを被せる。
 *
 * 原則は「元の中身を絶対に捨てない」。テスト送信は本番と同じものが届いて
 * 初めて意味があるので、バナーは header に足すだけで、body/hero/footer/styles
 * などには一切触らない。読めない・知らない形は加工せずそのまま返す
 * （バナーを諦める方が、別物を送るよりましなため）。
 *
 * 色は必ず 6桁 hex。LINE Messaging API の Flex は 3桁 hex (#333) を受け付けず、
 * "invalid property /header/contents/0/color" で 400 になる。
 */

type FlexNode = Record<string, unknown>;

const BANNER_BACKGROUND = "#FFE066";
const BANNER_TEXT_COLOR = "#333333";

/** バナー box。呼び出しごとに新しいオブジェクトを返す（共有参照を作らない） */
function bannerBox(): FlexNode {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: BANNER_BACKGROUND,
    paddingAll: "8px",
    contents: [
      {
        type: "text",
        text: "⚠️ テスト配信",
        size: "sm",
        weight: "bold",
        color: BANNER_TEXT_COLOR,
        align: "center",
      },
    ],
  };
}

function isPlainObject(value: unknown): value is FlexNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * bubble の header にバナーを足す。元の header がある場合は捨てずに
 * バナーの下へネストする（header は box なので box を子に持てる）。
 */
function bubbleWithBanner(bubble: FlexNode): FlexNode {
  const original = bubble.header;
  const header = isPlainObject(original)
    ? { type: "box", layout: "vertical", contents: [bannerBox(), original] }
    : bannerBox();
  return { ...bubble, header };
}

/**
 * Flex コンテナ JSON 文字列にテストバナーを付けて返す。
 * bubble / carousel 以外、または JSON として読めない入力は無加工で返す。
 */
export function addTestBannerToFlex(content: string): string {
  let flex: unknown;
  try {
    flex = JSON.parse(content);
  } catch {
    return content;
  }
  if (!isPlainObject(flex)) return content;

  if (flex.type === "bubble") {
    return JSON.stringify(bubbleWithBanner(flex));
  }

  if (flex.type === "carousel" && Array.isArray(flex.contents)) {
    // どの bubble から見てもテスト送信だと分かるよう全枚数に付ける。
    // 枚数も並び順も変えない（carousel は最大12枚なので差し込みは危険）。
    return JSON.stringify({
      ...flex,
      contents: flex.contents.map((bubble) =>
        isPlainObject(bubble) && bubble.type === "bubble" ? bubbleWithBanner(bubble) : bubble,
      ),
    });
  }

  return content;
}
