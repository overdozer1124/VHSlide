import { describe, expect, it } from "vitest";
import { defaultAccess, hostAccess } from "./permissions";
import {
  generalDeckAccess,
  stage1FeaturesEnabled,
} from "./stage1Capabilities";

describe("stage1Capabilities", () => {
  it("matches host / grant / default rules for general decks", () => {
    expect(
      generalDeckAccess({
        deckId: "d1",
        userId: "owner",
        ownerId: "owner",
        isMember: true,
      }),
    ).toMatchObject({
      kind: "general",
      host: true,
      member: true,
      access: hostAccess(),
    });

    const grant = JSON.stringify({
      ...defaultAccess(),
      mode: "all",
    });
    expect(
      generalDeckAccess({
        deckId: "d1",
        userId: "bob",
        ownerId: "owner",
        isMember: true,
        grantJson: grant,
      }).access.mode,
    ).toBe("all");

    expect(
      generalDeckAccess({
        deckId: "d1",
        userId: "eve",
        ownerId: "owner",
        isMember: false,
      }),
    ).toMatchObject({
      host: false,
      member: false,
      access: defaultAccess(),
    });

    expect(() =>
      generalDeckAccess({
        deckId: "d1",
        userId: "bob",
        ownerId: "owner",
        isMember: true,
        grantJson: "{not-json",
      }),
    ).toThrow();
  });

  it("enables stage1 features only with an explicit flag", () => {
    expect(stage1FeaturesEnabled({})).toBe(false);
    expect(stage1FeaturesEnabled({ STAGE1_FEATURES: "0" })).toBe(false);
    expect(stage1FeaturesEnabled({ STAGE1_FEATURES: "1" })).toBe(true);
    expect(stage1FeaturesEnabled({ STAGE1_FEATURES: "true" })).toBe(true);
  });
});
