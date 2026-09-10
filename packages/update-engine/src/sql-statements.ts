interface SqlToken {
  kind: 'word' | 'quoted' | 'symbol' | 'comment';
  value: string;
  start: number;
  end: number;
}

/** Lex once without interpreting keywords inside strings, identifiers or comments. */
function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (let i = 0; i < sql.length;) {
    const start = i;
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (sql.startsWith('--', i)) {
      i += 2;
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i += 1;
      tokens.push({ kind: 'comment', value: '', start, end: i });
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const closing = sql.indexOf('*/', i + 2);
      if (closing === -1) throw new Error('migration contains an unterminated SQL quote or block comment');
      i = closing + 2;
      tokens.push({ kind: 'comment', value: '', start, end: i });
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const closing = ch === '[' ? ']' : ch;
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== closing) continue;
        if (closing !== ']' && sql[i] === closing) {
          i += 1;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) throw new Error('migration contains an unterminated SQL quote or block comment');
      tokens.push({ kind: 'quoted', value: sql.slice(start, i), start, end: i });
      continue;
    }
    if (/[\w$\u0080-\uffff]/.test(ch)) {
      i += 1;
      while (i < sql.length && /[\w$\u0080-\uffff]/.test(sql[i])) i += 1;
      tokens.push({ kind: 'word', value: sql.slice(start, i).toUpperCase(), start, end: i });
      continue;
    }
    i += 1;
    tokens.push({ kind: 'symbol', value: ch, start, end: i });
  }
  return tokens;
}

/** Preserve quoted text and whitespace; a removed comment must not join two words. */
export function stripSqlComments(sql: string): string {
  let result = '';
  let start = 0;
  for (const token of tokenizeSql(sql)) {
    if (token.kind !== 'comment') continue;
    result += sql.slice(start, token.start) + sql.slice(token.start, token.end).replace(/[^\r\n]/g, ' ');
    start = token.end;
  }
  return result + sql.slice(start);
}

function hasDestructiveTokens(tokens: SqlToken[]): boolean {
  return tokens.some((token, index) => {
    const next = tokens[index + 1];
    if (token.kind !== 'word' || next?.kind !== 'word') return false;
    return (token.value === 'DROP' && /^(TABLE|COLUMN)$/.test(next.value)) ||
      (token.value === 'RENAME' && /^(TO|COLUMN)$/.test(next.value));
  });
}

/** Shared DROP/RENAME guard for splitting and grandfathered adoption. */
export function containsDestructiveSchemaChanges(sql: string): boolean {
  return hasDestructiveTokens(tokenizeSql(sql).filter((token) => token.kind !== 'comment'));
}

function keyword(token: SqlToken | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value === value;
}

function triggerError(detail: string): never {
  throw new Error(`malformed CREATE TRIGGER migration: ${detail}`);
}

function triggerCommand(token: SqlToken | undefined): boolean {
  return token?.kind === 'word' && /^(INSERT|UPDATE|DELETE|SELECT|REPLACE)$/.test(token.value);
}

/**
 * Validate the trigger envelope, not arbitrary SQL expressions. SQLite owns
 * expression/type/name validation. Body commands must end with a semicolon;
 * their CASE expressions must close before that delimiter. Only an END at a
 * command boundary may finish the trigger (https://sqlite.org/lang_createtrigger.html).
 */
function triggerEnd(tokens: SqlToken[], triggerIndex: number): number {
  let i = triggerIndex + 1;
  const take = (value: string): boolean => {
    if (!keyword(tokens[i], value)) return false;
    i += 1;
    return true;
  };
  const requireKeyword = (value: string): void => {
    if (!take(value)) triggerError(`expected ${value} in trigger header`);
  };
  const identifier = (): void => {
    if (tokens[i]?.kind !== 'word' && tokens[i]?.kind !== 'quoted') {
      triggerError('expected an identifier in trigger header');
    }
    i += 1;
  };
  const qualifiedIdentifier = (): void => {
    identifier();
    if (tokens[i]?.value === '.') {
      i += 1;
      identifier();
    }
  };

  if (take('IF')) {
    requireKeyword('NOT');
    requireKeyword('EXISTS');
  }
  qualifiedIdentifier();
  if (take('INSTEAD')) requireKeyword('OF');
  else if (!take('BEFORE')) take('AFTER');
  if (take('UPDATE')) {
    if (take('OF')) {
      identifier();
      while (tokens[i]?.value === ',') {
        i += 1;
        identifier();
      }
    }
  } else if (!take('INSERT') && !take('DELETE')) {
    triggerError('expected INSERT, UPDATE or DELETE in trigger header');
  }
  requireKeyword('ON');
  qualifiedIdentifier();
  if (take('FOR')) {
    requireKeyword('EACH');
    requireKeyword('ROW');
  }

  let parentheses = 0;
  const cases: Array<{
    parentheses: number;
    phase: 'base' | 'when' | 'then' | 'else';
    needsOperand: boolean;
  }> = [];
  const expressionToken = (token: SqlToken, previous: SqlToken | undefined): void => {
    const qualified = previous?.value === '.';
    if (token.value === '(') parentheses += 1;
    if (token.value === ')' && --parentheses < 0) triggerError('unbalanced parentheses');
    if (!qualified && keyword(token, 'CASE')) {
      cases.push({ parentheses, phase: 'base', needsOperand: true });
      return;
    }
    const current = cases.at(-1);
    if (!current) return;
    if (!qualified && parentheses === current.parentheses) {
      if (keyword(token, 'WHEN') || keyword(token, 'THEN') || keyword(token, 'ELSE')) {
        current.phase = token.value.toLowerCase() as 'when' | 'then' | 'else';
        current.needsOperand = true;
        return;
      }
      // END also falls back to an identifier in SQLite. In `THEN end END`
      // the first END is the result operand, and only the second closes CASE.
      if (keyword(token, 'END') && !current.needsOperand &&
          (current.phase === 'then' || current.phase === 'else')) {
        cases.pop();
        const parent = cases.at(-1);
        if (parent) parent.needsOperand = false;
        return;
      }
    }
    // Only enough expression context to distinguish fallback identifiers
    // from CASE terminators; SQLite still validates the expression itself.
    current.needsOperand = token.kind === 'symbol'
      ? token.value !== ')'
      : token.kind === 'word' && /^(AND|OR|NOT|IS|IN|LIKE|GLOB|MATCH|REGEXP|BETWEEN|ESCAPE|AS|SELECT|DISTINCT|ALL|FROM|JOIN|ON|WHERE|HAVING|BY|SET|VALUES|RETURNING|COLLATE)$/.test(token.value);
  };
  // A WHEN clause can itself contain CASE ... END and parenthesized subqueries.
  if (take('WHEN')) {
    const conditionStart = i;
    for (; i < tokens.length; i += 1) {
      const token = tokens[i];
      const qualified = tokens[i - 1]?.value === '.';
      // BEGIN can be an unquoted column name (`WHEN begin > 0 BEGIN ...`).
      // The envelope delimiter must introduce a body command (or empty END,
      // which the body validator rejects), rather than consume that operand.
      if (keyword(token, 'BEGIN') && !qualified && parentheses === 0 && cases.length === 0 &&
          (triggerCommand(tokens[i + 1]) || keyword(tokens[i + 1], 'END'))) break;
      if (token.value === ';') triggerError('missing BEGIN after WHEN clause');
      expressionToken(token, tokens[i - 1]);
    }
    if (conditionStart === i) triggerError('empty WHEN clause');
  }
  requireKeyword('BEGIN');

  let commands = 0;
  let commandStart = i;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (i === commandStart) {
      if (keyword(token, 'END')) {
        if (commands === 0) triggerError('empty trigger body');
        if (tokens[i + 1] && tokens[i + 1].value !== ';') {
          triggerError('expected semicolon after END');
        }
        return i;
      }
      if (!triggerCommand(token)) {
        triggerError('expected a trigger body command or END');
      }
    }
    expressionToken(token, tokens[i - 1]);
    if (token.value === ';') {
      if (cases.length || parentheses) triggerError('unclosed CASE or parentheses in trigger body');
      if (i === commandStart + 1) triggerError('incomplete trigger body command');
      commands += 1;
      commandStart = i + 1;
    }
  }
  return triggerError('unterminated trigger body (expected END)');
}

/**
 * Split cumulative SQLite migrations for individual D1 requests, preserving
 * complete trigger programs and their internal semicolons. Validate all input
 * before execution so an incomplete trigger cannot leave a partial migration.
 */
export function splitSqlStatements(sql: string): string[] {
  const tokens = tokenizeSql(sql).filter((token) => token.kind !== 'comment');
  if (hasDestructiveTokens(tokens)) {
    throw new Error('destructive schema changes are not supported by safe D1 updates');
  }
  const statements: string[] = [];
  let start = 0;
  let firstToken = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (i === firstToken && keyword(tokens[i], 'CREATE')) {
      let next = i + 1;
      if (keyword(tokens[next], 'TEMP') || keyword(tokens[next], 'TEMPORARY')) next += 1;
      if (keyword(tokens[next], 'TRIGGER')) i = triggerEnd(tokens, next);
    }
    if (tokens[i].value !== ';') continue;
    if (i > firstToken) statements.push(sql.slice(start, tokens[i].start).trim());
    start = tokens[i].end;
    firstToken = i + 1;
  }
  if (firstToken < tokens.length) statements.push(sql.slice(start).trim());
  return statements;
}
