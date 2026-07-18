function buildRewardMessage(template, friendDisplayName) {
  if (!template) return null;
  const safeDisplay = friendDisplayName ?? "";
  if (template.message_type === "text") {
    return {
      type: "text",
      text: template.message_content.replaceAll("{displayName}", safeDisplay)
    };
  }
  const jsonEscaped = JSON.stringify(safeDisplay).slice(1, -1);
  const replaced = template.message_content.replaceAll("{displayName}", jsonEscaped);
  try {
    return {
      type: "flex",
      altText: template.name,
      contents: JSON.parse(replaced)
    };
  } catch {
    return null;
  }
}
export {
  buildRewardMessage
};
