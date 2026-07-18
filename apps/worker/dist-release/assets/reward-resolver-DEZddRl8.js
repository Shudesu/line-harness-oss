async function resolveRewardTemplate(db, args, deps) {
  if (args.requestedTrackedLinkId) {
    const link = await deps.getTrackedLinkById(db, args.requestedTrackedLinkId);
    if (link) {
      if (!link.reward_template_id) return null;
      return await deps.getMessageTemplateById(db, link.reward_template_id);
    }
  }
  const friend = await deps.getFriendById(db, args.friendId);
  if (friend?.first_tracked_link_id) {
    const link = await deps.getTrackedLinkById(db, friend.first_tracked_link_id);
    if (link?.reward_template_id) {
      const tpl = await deps.getMessageTemplateById(db, link.reward_template_id);
      if (tpl) return tpl;
    }
  }
  return null;
}
export {
  resolveRewardTemplate
};
