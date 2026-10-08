import { describe, expect, it } from "vitest";
import { SearchProductsInput, validateUiBlock, levelAllows, UI_COMPONENTS } from "../src/index.js";

const allowed = {
  productIds: new Set(["P1", "P2"]),
  storeIds: new Set(["S1"]),
  sizes: new Map([["P1", new Set(["M"])]]),
};

describe("Gen UI : validation structurelle et sémantique (S5)", () => {
  it("accepte un bloc qui ne référence que des identifiants du tour", () => {
    const r = validateUiBlock({ component: "ProductCarousel", props: { heading: "look", productIds: ["P1", "P2"] } }, UI_COMPONENTS, allowed);
    expect(r.ok).toBe(true);
  });

  it("refuse un produit inventé par le modèle", () => {
    const r = validateUiBlock({ component: "ProductCard", props: { productId: "INVENTE" } }, UI_COMPONENTS, allowed);
    expect(r).toMatchObject({ ok: false });
  });

  it("refuse une taille non issue des outils", () => {
    const r = validateUiBlock({ component: "SizePicker", props: { productId: "P1", recommendedSize: "XL" } }, UI_COMPONENTS, allowed);
    expect(r.ok).toBe(false);
  });

  it("refuse un composant hors catalogue et des props inconnues", () => {
    expect(validateUiBlock({ component: "Html", props: { html: "<script>" } }, UI_COMPONENTS, allowed).ok).toBe(false);
    expect(validateUiBlock({ component: "ProductCard", props: { productId: "P1", price: 1 } }, UI_COMPONENTS, allowed).ok).toBe(false);
    expect(validateUiBlock({ component: "StoreStock", props: { productId: "P1", storeIds: ["S1"] } }, ["ProductCard"], allowed).ok).toBe(false);
  });
});

describe("Contrats publics v1", () => {
  it("les entrées sont strictes : un customerId glissé est refusé (S1, S2)", () => {
    expect(SearchProductsInput.safeParse({ query: "pull", customerId: "c-1002" }).success).toBe(false);
  });

  it("le niveau interne n'hérite pas du niveau session", () => {
    expect(levelAllows("interne", "session")).toBe(false);
    expect(levelAllows("session", "public")).toBe(true);
    expect(levelAllows("public", "session")).toBe(false);
    expect(levelAllows("session", "interne")).toBe(false);
  });
});
