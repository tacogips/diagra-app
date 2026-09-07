/** Numeric literals and arithmetic only; never evaluates JavaScript or identifiers. */
export function parseNumberExpression(source: string): number | null {
  if (!source.trim() || source.length > 256) return null;
  let at = 0;
  const space = () => {
    while (/\s/.test(source[at] ?? "") && at < source.length) at++;
  };
  const take = (token: string) => {
    space();
    if (source[at] !== token) return false;
    at++;
    return true;
  };
  const atom = (): number => {
    if (take("+")) return atom();
    if (take("-")) return -atom();
    if (take("(")) {
      const value = sum();
      if (!take(")")) throw new Error("Unclosed expression");
      return value;
    }
    space();
    const literal = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      source.slice(at),
    );
    if (!literal) throw new Error("Expected number");
    at += literal[0].length;
    const value = Number(literal[0]);
    if (!Number.isFinite(value)) throw new Error("Number overflow");
    return value;
  };
  const product = (): number => {
    let value = atom();
    while (true) {
      if (take("*")) value *= atom();
      else if (take("/")) {
        const divisor = atom();
        if (divisor === 0) throw new Error("Division by zero");
        value /= divisor;
      } else return value;
      if (!Number.isFinite(value)) throw new Error("Number overflow");
    }
  };
  const sum = (): number => {
    let value = product();
    while (true) {
      if (take("+")) value += product();
      else if (take("-")) value -= product();
      else return value;
      if (!Number.isFinite(value)) throw new Error("Number overflow");
    }
  };
  try {
    const value = sum();
    space();
    return at === source.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
