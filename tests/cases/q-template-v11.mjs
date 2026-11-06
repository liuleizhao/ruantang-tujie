// Q. 模板 v1.1 渲染位（契约 §5b / lead 增补 Q）
// 只检查源码里存在对应处理逻辑/字段名，不要求精确 DOM。
import fs from 'node:fs';
import { assert } from '../lib/harness.mjs';

export function register(h, ctx) {
  h.section('Q. 模板 v1.1 渲染位（decor / loop / buildOrder / warnings）');

  const read = () => {
    if (!fs.existsSync(ctx.TEMPLATE_PATH)) {
      throw new (class extends Error {})(`模板尚未交付：${ctx.rel(ctx.TEMPLATE_PATH)}`);
    }
    return fs.readFileSync(ctx.TEMPLATE_PATH, 'utf8');
  };

  h.it('模板处理 round.decor（装饰针迹）', () => {
    const html = read();
    assert.match(html, /\.decor\b|\[['"]decor['"]\]|decor\s*[*&|?]/,
      '模板应读取 round.decor 并渲染装饰针迹（契约 §5b.1）');
  });

  h.it('模板处理 round.loop / reservedFor（半针留针）', () => {
    const html = read();
    assert.match(html, /\.loop\b|\[['"]loop['"]\]|reservedFor|blo|flo/,
      '模板应处理 round.loop / reservedFor（契约 §5b.2）');
  });

  h.it('模板处理 chart.buildOrder（制作顺序）', () => {
    const html = read();
    assert.match(html, /buildOrder/,
      '模板应渲染 chart.buildOrder 制作顺序（契约 §5b.4）');
  });

  h.it('模板处理 chart.validation.warnings（警告区）', () => {
    const html = read();
    assert.match(html, /warnings?/,
      '模板应渲染 validation.warnings（契约 §5b.3）');
  });
}
