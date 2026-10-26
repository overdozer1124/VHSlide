import { test, expect } from '@playwright/test';
test('trackpad pinch-out enlarges the selected thumbnail into editor', async ({page},info) => {
 test.skip(info.project.name !== 'desktop'); await page.goto('/');
 const thumb=page.locator('.map-grid .thumbnail').first();
 const before=(await thumb.boundingBox())!;
 await thumb.evaluate(node=>{const b=node.getBoundingClientRect();node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-30,clientX:b.x+b.width/2,clientY:b.y+b.height/2}));});
 const flight=page.locator('.workspace-flight'); await expect(flight).toBeVisible();
 const measurement=await flight.evaluate(async node=>{await new Promise(r=>setTimeout(r,80));const anim=node.getAnimations()[0];return {running:!!anim,from:anim && (anim.effect as KeyframeEffect).getKeyframes()[0].transform, to:anim && (anim.effect as KeyframeEffect).getKeyframes().at(-1)?.transform,width:node.getBoundingClientRect().width};});
 expect(measurement.running).toBe(true);expect(measurement.from).not.toBe(measurement.to);expect(measurement.width).toBeGreaterThan(before.width);
 await page.locator('.editor-pager').dispatchEvent('pointerdown', {pointerType:'touch', bubbles:true});
 await expect(flight).toBeVisible();
 await expect(flight).toHaveCount(0);await expect(page.locator('.editor-pager')).toBeVisible();
});
