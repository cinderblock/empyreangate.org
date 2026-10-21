// The editor's canvas in the playground specs.

import { expect, type Locator, type Page } from "@playwright/test";

/** Pan the canvas, as a person would by dragging its background, until
 * `node` sits a third of the way into it: clear of the Gate globals card
 * (bottom right) and the zoom controls (bottom left), wherever the patch's
 * layout and the zoom it opened at happened to put it. A test that clicks
 * a node should not depend on the patch fitting the window. */
export async function bringIntoView(page: Page, node: Locator) {
  const pane = (await page.locator(".react-flow").boundingBox())!;
  const box = (await node.boundingBox())!;
  // A point of bare canvas to drag from: the pane itself is the topmost
  // element there, not a node, a wire or a panel.
  const from = await page.evaluate(
    ({ x, y, w, h }) => {
      for (const [fx, fy] of [
        [0.03, 0.03],
        [0.5, 0.03],
        [0.97, 0.03],
        [0.03, 0.5],
        [0.97, 0.5],
      ]) {
        const px = x + w * fx;
        const py = y + h * fy;
        if (
          document
            .elementFromPoint(px, py)
            ?.classList.contains("react-flow__pane")
        )
          return { x: px, y: py };
      }
      return null;
    },
    { x: pane.x, y: pane.y, w: pane.width, h: pane.height },
  );
  expect(from, "a bare spot of canvas to drag").not.toBeNull();
  const dx = pane.x + pane.width / 3 - (box.x + box.width / 2);
  const dy = pane.y + pane.height / 3 - (box.y + box.height / 2);
  await page.mouse.move(from!.x, from!.y);
  await page.mouse.down();
  await page.mouse.move(from!.x + dx, from!.y + dy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = (await node.boundingBox())!;
      return Math.hypot(
        b.x + b.width / 2 - (pane.x + pane.width / 3),
        b.y + b.height / 2 - (pane.y + pane.height / 3),
      );
    })
    .toBeLessThan(4);
}
