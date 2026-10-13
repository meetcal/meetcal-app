import { expect, test } from "@playwright/test";

const track = ".screenshot-track";

async function animationState(page: import("@playwright/test").Page) {
  return page.locator(track).evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, playState: style.animationPlayState };
  });
}

test("the screenshot marquee loads small, lazy images", async ({ page }) => {
  await page.goto("/");
  const images = page.locator(".screenshot-set img");
  await expect(images).toHaveCount(20);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute("src", /\/images\/\d\d\.webp$/);
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect(image).toHaveAttribute("width", "220");
  }
});

test("the screenshot marquee can be paused and resumed", async ({ page }) => {
  await page.goto("/");
  const pause = page.getByRole("button", { name: "Pause preview" });
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  expect(await animationState(page)).toEqual({ name: "scroll-screenshots", playState: "running" });

  // Hovering the marquee also pauses it. Keep the pointer on the toggle, off
  // the marquee: Chromium re-checks hover after the scroll that pressing the
  // button causes, and its pointer's resting spot (0, 0) is then over the
  // full-width marquee.
  await pause.hover();
  expect((await animationState(page)).playState).toBe("running");

  await pause.press("Enter");
  const play = page.getByRole("button", { name: "Play preview" });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  expect((await animationState(page)).playState).toBe("paused");

  await play.press("Enter");
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible();
  expect((await animationState(page)).playState).toBe("running");
});

test("hovering the screenshot marquee pauses it", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones have no hover");
  await page.goto("/");
  await page.locator(".screenshot-marquee").hover();
  expect((await animationState(page)).playState).toBe("paused");
  await page.getByRole("button", { name: "Pause preview" }).hover();
  expect((await animationState(page)).playState).toBe("running");
});

test("reduced motion stops the marquee", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".screenshot-set img").first()).toBeAttached();
  expect((await animationState(page)).name).toBe("none");
  await expect(page.getByRole("button", { name: /preview/ })).toBeHidden();
});
