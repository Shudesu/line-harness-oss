// =============================================================================
// Rich Message Builders — LINE Messaging API message type builders
// =============================================================================

import type { Message, FlexContainer } from './types.js';

// ── Text Message ────────────────────────────────────────────────────────────

export function textMessage(text: string): Message {
  return { type: 'text', text };
}

// ── Image Message ───────────────────────────────────────────────────────────

export function imageMessage(
  originalContentUrl: string,
  previewImageUrl?: string,
): Message {
  return {
    type: 'image',
    originalContentUrl,
    previewImageUrl: previewImageUrl || originalContentUrl,
  };
}

// ── Flex Message ────────────────────────────────────────────────────────────

export function flexMessage(altText: string, contents: FlexContainer): Message {
  return { type: 'flex', altText, contents };
}

// ── Video Message ───────────────────────────────────────────────────────────

export interface VideoMessage {
  type: 'video';
  originalContentUrl: string;
  previewImageUrl: string;
}

export function videoMessage(
  originalContentUrl: string,
  previewImageUrl: string,
): VideoMessage {
  return { type: 'video', originalContentUrl, previewImageUrl };
}

// ── Template Messages ───────────────────────────────────────────────────────

export interface TemplateAction {
  type: 'uri' | 'message' | 'postback';
  label: string;
  uri?: string;
  text?: string;
  data?: string;
}

export interface ButtonsTemplate {
  type: 'template';
  altText: string;
  template: {
    type: 'buttons';
    thumbnailImageUrl?: string;
    title?: string;
    text: string;
    actions: TemplateAction[];
  };
}

export function buttonsTemplate(opts: {
  altText: string;
  text: string;
  title?: string;
  thumbnailImageUrl?: string;
  actions: TemplateAction[];
}): ButtonsTemplate {
  return {
    type: 'template',
    altText: opts.altText,
    template: {
      type: 'buttons',
      thumbnailImageUrl: opts.thumbnailImageUrl,
      title: opts.title,
      text: opts.text,
      actions: opts.actions,
    },
  };
}

export interface ConfirmTemplate {
  type: 'template';
  altText: string;
  template: {
    type: 'confirm';
    text: string;
    actions: [TemplateAction, TemplateAction];
  };
}

export function confirmTemplate(opts: {
  altText: string;
  text: string;
  yesAction: TemplateAction;
  noAction: TemplateAction;
}): ConfirmTemplate {
  return {
    type: 'template',
    altText: opts.altText,
    template: {
      type: 'confirm',
      text: opts.text,
      actions: [opts.yesAction, opts.noAction],
    },
  };
}

export interface CarouselColumn {
  thumbnailImageUrl?: string;
  title?: string;
  text: string;
  actions: TemplateAction[];
}

export interface CarouselTemplate {
  type: 'template';
  altText: string;
  template: {
    type: 'carousel';
    columns: CarouselColumn[];
  };
}

export function carouselTemplate(
  altText: string,
  columns: CarouselColumn[],
): CarouselTemplate {
  return {
    type: 'template',
    altText,
    template: {
      type: 'carousel',
      columns,
    },
  };
}

// ── Image Map Message ───────────────────────────────────────────────────────

export interface ImageMapAction {
  type: 'uri' | 'message';
  linkUri?: string;
  text?: string;
  area: { x: number; y: number; width: number; height: number };
}

export interface ImageMapMessage {
  type: 'imagemap';
  baseUrl: string;
  altText: string;
  baseSize: { width: number; height: number };
  actions: ImageMapAction[];
}

export function imageMapMessage(opts: {
  baseUrl: string;
  altText: string;
  baseSize: { width: number; height: number };
  actions: ImageMapAction[];
}): ImageMapMessage {
  return {
    type: 'imagemap',
    baseUrl: opts.baseUrl,
    altText: opts.altText,
    baseSize: opts.baseSize,
    actions: opts.actions,
  };
}

// ── Quick Reply ─────────────────────────────────────────────────────────────

export interface QuickReplyItem {
  type: 'action';
  imageUrl?: string;
  action: TemplateAction;
}

export interface QuickReply {
  items: QuickReplyItem[];
}

export function quickReply(items: QuickReplyItem[]): QuickReply {
  return { items };
}

export function withQuickReply<T extends object>(
  message: T,
  reply: QuickReply,
): T & { quickReply: QuickReply } {
  return { ...message, quickReply: reply };
}

// ── Flex Builders ───────────────────────────────────────────────────────────

export interface FlexBox {
  type: 'box';
  layout: 'horizontal' | 'vertical' | 'baseline';
  contents: FlexComponent[];
  spacing?: string;
  margin?: string;
  paddingAll?: string;
  paddingTop?: string;
  backgroundColor?: string;
  cornerRadius?: string;
  action?: TemplateAction;
}

export interface FlexText {
  type: 'text';
  text: string;
  size?: string;
  weight?: string;
  color?: string;
  wrap?: boolean;
  align?: string;
  flex?: number;
  margin?: string;
  action?: TemplateAction;
}

export interface FlexImage {
  type: 'image';
  url: string;
  size?: string;
  aspectRatio?: string;
  aspectMode?: string;
  action?: TemplateAction;
}

export interface FlexButton {
  type: 'button';
  style?: 'primary' | 'secondary' | 'link';
  color?: string;
  action: TemplateAction;
  height?: string;
  margin?: string;
}

export interface FlexSeparator {
  type: 'separator';
  margin?: string;
  color?: string;
}

export interface FlexSpacer {
  type: 'spacer';
  size?: string;
}

export type FlexComponent = FlexBox | FlexText | FlexImage | FlexButton | FlexSeparator | FlexSpacer;

export interface FlexBubble {
  type: 'bubble';
  size?: string;
  header?: FlexBox;
  hero?: FlexImage;
  body?: FlexBox;
  footer?: FlexBox;
  styles?: Record<string, unknown>;
}

export interface FlexCarousel {
  type: 'carousel';
  contents: FlexBubble[];
}

export function flexBubble(opts: {
  size?: string;
  header?: FlexBox;
  hero?: FlexImage;
  body?: FlexBox;
  footer?: FlexBox;
}): FlexBubble {
  return { type: 'bubble', ...opts };
}

export function flexCarousel(bubbles: FlexBubble[]): FlexCarousel {
  return { type: 'carousel', contents: bubbles };
}

export function flexBox(
  layout: 'horizontal' | 'vertical' | 'baseline',
  contents: FlexComponent[],
  opts?: Partial<Omit<FlexBox, 'type' | 'layout' | 'contents'>>,
): FlexBox {
  return { type: 'box', layout, contents, ...opts };
}

export function flexText(
  text: string,
  opts?: Partial<Omit<FlexText, 'type' | 'text'>>,
): FlexText {
  return { type: 'text', text, ...opts };
}

export function flexImage(
  url: string,
  opts?: Partial<Omit<FlexImage, 'type' | 'url'>>,
): FlexImage {
  return { type: 'image', url, ...opts };
}

export function flexButton(
  action: TemplateAction,
  opts?: Partial<Omit<FlexButton, 'type' | 'action'>>,
): FlexButton {
  return { type: 'button', action, ...opts };
}

// ── Receipt / Product Card Helpers ──────────────────────────────────────────

export function productCard(opts: {
  imageUrl: string;
  name: string;
  price: string;
  description?: string;
  actionUrl: string;
}): FlexBubble {
  return flexBubble({
    hero: flexImage(opts.imageUrl, {
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    }),
    body: flexBox('vertical', [
      flexText(opts.name, { weight: 'bold', size: 'lg' }),
      ...(opts.description ? [flexText(opts.description, { size: 'sm', color: '#999999', wrap: true, margin: 'md' })] : []),
      flexText(opts.price, { size: 'xl', weight: 'bold', color: '#06C755', margin: 'md' }),
    ]),
    footer: flexBox('vertical', [
      flexButton(
        { type: 'uri', label: '詳細を見る', uri: opts.actionUrl },
        { style: 'primary', color: '#06C755' },
      ),
    ]),
  });
}

export function receiptMessage(opts: {
  storeName: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
}): FlexBubble {
  const itemComponents: FlexComponent[] = opts.items.map((item) =>
    flexBox('horizontal', [
      flexText(item.name, { size: 'sm', flex: 3 }),
      flexText(`x${item.quantity}`, { size: 'sm', flex: 1, align: 'end' }),
      flexText(`¥${item.price.toLocaleString()}`, { size: 'sm', flex: 2, align: 'end' }),
    ]),
  );

  return flexBubble({
    body: flexBox('vertical', [
      flexText(opts.storeName, { weight: 'bold', size: 'lg' }),
      { type: 'separator', margin: 'md' },
      flexBox('vertical', itemComponents, { margin: 'md', spacing: 'sm' }),
      { type: 'separator', margin: 'md' },
      flexBox('horizontal', [
        flexText('合計', { weight: 'bold', size: 'md', flex: 3 }),
        flexText(`¥${opts.total.toLocaleString()}`, { weight: 'bold', size: 'md', flex: 2, align: 'end', color: '#06C755' }),
      ], { margin: 'md' }),
    ]),
  });
}
