import { dq as LineClient } from "./worker-entry-erCCD8uv.js";
import { dr } from "./worker-entry-erCCD8uv.js";
import "node:events";
import "node:stream";
import "node:crypto";
import "node:zlib";
import "events";
function textMessage(text) {
  return { type: "text", text };
}
function imageMessage(originalContentUrl, previewImageUrl) {
  return {
    type: "image",
    originalContentUrl,
    previewImageUrl: previewImageUrl || originalContentUrl
  };
}
function flexMessage(altText, contents) {
  return { type: "flex", altText, contents };
}
function videoMessage(originalContentUrl, previewImageUrl) {
  return { type: "video", originalContentUrl, previewImageUrl };
}
function buttonsTemplate(opts) {
  return {
    type: "template",
    altText: opts.altText,
    template: {
      type: "buttons",
      thumbnailImageUrl: opts.thumbnailImageUrl,
      title: opts.title,
      text: opts.text,
      actions: opts.actions
    }
  };
}
function confirmTemplate(opts) {
  return {
    type: "template",
    altText: opts.altText,
    template: {
      type: "confirm",
      text: opts.text,
      actions: [opts.yesAction, opts.noAction]
    }
  };
}
function carouselTemplate(altText, columns) {
  return {
    type: "template",
    altText,
    template: {
      type: "carousel",
      columns
    }
  };
}
function imageMapMessage(opts) {
  return {
    type: "imagemap",
    baseUrl: opts.baseUrl,
    altText: opts.altText,
    baseSize: opts.baseSize,
    actions: opts.actions
  };
}
function quickReply(items) {
  return { items };
}
function withQuickReply(message, reply) {
  return { ...message, quickReply: reply };
}
function flexBubble(opts) {
  return { type: "bubble", ...opts };
}
function flexCarousel(bubbles) {
  return { type: "carousel", contents: bubbles };
}
function flexBox(layout, contents, opts) {
  return { type: "box", layout, contents, ...opts };
}
function flexText(text, opts) {
  return { type: "text", text, ...opts };
}
function flexImage(url, opts) {
  return { type: "image", url, ...opts };
}
function flexButton(action, opts) {
  return { type: "button", action, ...opts };
}
function productCard(opts) {
  return flexBubble({
    hero: flexImage(opts.imageUrl, {
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover"
    }),
    body: flexBox("vertical", [
      flexText(opts.name, { weight: "bold", size: "lg" }),
      ...opts.description ? [flexText(opts.description, { size: "sm", color: "#999999", wrap: true, margin: "md" })] : [],
      flexText(opts.price, { size: "xl", weight: "bold", color: "#06C755", margin: "md" })
    ]),
    footer: flexBox("vertical", [
      flexButton({ type: "uri", label: "詳細を見る", uri: opts.actionUrl }, { style: "primary", color: "#06C755" })
    ])
  });
}
function receiptMessage(opts) {
  const itemComponents = opts.items.map((item) => flexBox("horizontal", [
    flexText(item.name, { size: "sm", flex: 3 }),
    flexText(`x${item.quantity}`, { size: "sm", flex: 1, align: "end" }),
    flexText(`¥${item.price.toLocaleString()}`, { size: "sm", flex: 2, align: "end" })
  ]));
  return flexBubble({
    body: flexBox("vertical", [
      flexText(opts.storeName, { weight: "bold", size: "lg" }),
      { type: "separator", margin: "md" },
      flexBox("vertical", itemComponents, { margin: "md", spacing: "sm" }),
      { type: "separator", margin: "md" },
      flexBox("horizontal", [
        flexText("合計", { weight: "bold", size: "md", flex: 3 }),
        flexText(`¥${opts.total.toLocaleString()}`, { weight: "bold", size: "md", flex: 2, align: "end", color: "#06C755" })
      ], { margin: "md" })
    ])
  });
}
export {
  LineClient,
  buttonsTemplate,
  carouselTemplate,
  confirmTemplate,
  flexBox,
  flexBubble,
  flexButton,
  flexCarousel,
  flexImage,
  flexMessage,
  flexText,
  imageMapMessage,
  imageMessage,
  productCard,
  quickReply,
  receiptMessage,
  textMessage,
  dr as verifySignature,
  videoMessage,
  withQuickReply
};
