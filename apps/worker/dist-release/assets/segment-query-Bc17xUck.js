function buildSegmentQuery(condition) {
  const bindings = [];
  const clauses = [];
  for (const rule of condition.rules) {
    switch (rule.type) {
      case "tag_exists": {
        if (typeof rule.value !== "string") {
          throw new Error("tag_exists rule requires a string tag ID value");
        }
        clauses.push(
          `EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`
        );
        bindings.push(rule.value);
        break;
      }
      case "tag_not_exists": {
        if (typeof rule.value !== "string") {
          throw new Error("tag_not_exists rule requires a string tag ID value");
        }
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`
        );
        bindings.push(rule.value);
        break;
      }
      case "metadata_equals": {
        if (typeof rule.value !== "object" || rule.value === null || typeof rule.value.key !== "string" || typeof rule.value.value !== "string") {
          throw new Error("metadata_equals rule requires { key: string; value: string }");
        }
        const mv = rule.value;
        clauses.push(`json_extract(f.metadata, ?) = ?`);
        bindings.push(`$.${mv.key}`, mv.value);
        break;
      }
      case "metadata_not_equals": {
        if (typeof rule.value !== "object" || rule.value === null || typeof rule.value.key !== "string" || typeof rule.value.value !== "string") {
          throw new Error("metadata_not_equals rule requires { key: string; value: string }");
        }
        const mv = rule.value;
        clauses.push(`(json_extract(f.metadata, ?) IS NULL OR json_extract(f.metadata, ?) != ?)`);
        bindings.push(`$.${mv.key}`, `$.${mv.key}`, mv.value);
        break;
      }
      case "ref_code": {
        if (typeof rule.value !== "string") {
          throw new Error("ref_code rule requires a string value");
        }
        clauses.push(`f.ref_code = ?`);
        bindings.push(rule.value);
        break;
      }
      case "is_following": {
        if (typeof rule.value !== "boolean") {
          throw new Error("is_following rule requires a boolean value");
        }
        clauses.push(`f.is_following = ?`);
        bindings.push(rule.value ? 1 : 0);
        break;
      }
      default: {
        const exhaustive = rule.type;
        throw new Error(`Unknown segment rule type: ${exhaustive}`);
      }
    }
  }
  const separator = condition.operator === "AND" ? " AND " : " OR ";
  const where = clauses.length > 0 ? clauses.join(separator) : "1=1";
  const sql = `SELECT f.id, f.line_user_id FROM friends f WHERE ${where}`;
  return { sql, bindings };
}
export {
  buildSegmentQuery
};
