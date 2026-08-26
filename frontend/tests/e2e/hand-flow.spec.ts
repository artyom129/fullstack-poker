import { expect, type Page, test } from "@playwright/test";

async function expectSavedAfterReload(page: Page) {
  await expect(page.getByTestId("hand-completed")).toContainText("Saved to history");
  const savedId = await page.locator(".history-id span").first().innerText();

  await page.reload();

  await expect(page.getByTestId("hand-history")).toContainText(savedId);
}

test("persists a fold-to-win hand after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starting-stack").fill("120");
  await page.getByTestId("start-reset").click();

  for (let index = 0; index < 5; index += 1) {
    await page.getByTestId("action-fold").click();
  }

  await expectSavedAfterReload(page);
});

test("persists a normal checked-down showdown after reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByTestId("starting-stack").fill("200");
  await page.getByTestId("start-reset").click();

  for (let index = 0; index < 5; index += 1) {
    await page.getByTestId("action-call").click();
  }
  await page.getByTestId("action-check").click();

  for (let index = 0; index < 18; index += 1) {
    await page.getByTestId("action-check").click();
  }

  await expectSavedAfterReload(page);
});

test("resets with the next configured stack and persists an all-in hand", async ({ page }) => {
  await page.goto("/");

  const stackInput = page.getByTestId("starting-stack");
  const startReset = page.getByTestId("start-reset");

  await expect(stackInput).toBeEnabled();
  await expect(startReset).toHaveText("Start");
  await stackInput.fill("80");
  await startReset.click();

  await expect(stackInput).toBeEnabled();
  await expect(startReset).toHaveText("Start");
  await expect(startReset).toBeDisabled();

  const activeStacks = await page.locator(".player-seat").allTextContents();
  await stackInput.fill("120");
  expect(await page.locator(".player-seat").allTextContents()).toEqual(activeStacks);

  await page.getByTestId("action-allin").click();
  await expect(startReset).toHaveText("Reset");
  await expect(startReset).toBeEnabled();
  await startReset.click();

  await expect(startReset).toHaveText("Start");
  await expect(page.locator(".player-seat").filter({ hasText: "Stack 120" })).toHaveCount(4);

  for (let index = 0; index < 6; index += 1) {
    await page.getByTestId("action-allin").click();
  }

  await expectSavedAfterReload(page);
});

