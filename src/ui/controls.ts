/**
 * Piccoli helper per costruire il pannello di controllo senza framework.
 * Volutamente minimale: il prototipo serve a valutare il render, non l'interfaccia.
 */

export function section(parent: HTMLElement, title: string): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  details.className = 'section';
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.appendChild(summary);
  parent.appendChild(details);
  return details;
}

export function slider(
  parent: HTMLElement,
  label: string,
  opts: { min: number; max: number; step: number; value: number; unit?: string; format?: (v: number) => string },
  onChange: (v: number) => void,
): HTMLInputElement {
  const row = document.createElement('label');
  row.className = 'row';
  const name = document.createElement('span');
  name.textContent = label;
  const out = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  const show = () =>
    (out.textContent = opts.format ? opts.format(Number(input.value)) : `${Number(input.value)}${opts.unit ?? ''}`);
  input.addEventListener('input', () => {
    show();
    onChange(Number(input.value));
  });
  show();
  row.append(name, out, input);
  parent.appendChild(row);
  return input;
}

export function select<T extends string>(
  parent: HTMLElement,
  label: string,
  options: Record<T, string>,
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const row = document.createElement('label');
  row.className = 'row';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('select');
  for (const [key, text] of Object.entries(options) as [T, string][]) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = text;
    input.appendChild(opt);
  }
  input.value = value;
  input.addEventListener('change', () => onChange(input.value as T));
  row.append(name, input);
  parent.appendChild(row);
  return input;
}

export function checkbox(
  parent: HTMLElement,
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const row = document.createElement('label');
  row.className = 'row check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const name = document.createElement('span');
  name.textContent = label;
  row.append(input, name);
  parent.appendChild(row);
  return input;
}

export function button(parent: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (primary) b.className = 'primary';
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

export function buttonRow(parent: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'buttons';
  parent.appendChild(row);
  return row;
}
