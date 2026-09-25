/**
 * Passkey / embedded-wallet adapter.
 *
 * No provider is wired up yet, so this is a mock that produces the real states.
 * When Privy or Turnkey lands, it replaces the body of `createPasskey` and
 * nothing above it changes - that is the point of keeping it behind one call.
 */

export type PasskeyStatus = "idle" | "creating" | "created" | "failed";

export type PasskeyAccount = {
  address: string;
  label: string;
  createdAt: string;
};

export type IdentityPath = "passkey" | "wallet";

const PROVIDER = "mock" as const;

export const IDENTITY_PROVIDER_NOTE =
  PROVIDER === "mock"
    ? "Simulated in this build. The states below are the ones a real passkey provider produces, so wiring one in is an adapter swap, not a redesign."
    : "";

export async function createPasskey(): Promise<
  { ok: true; account: PasskeyAccount } | { ok: false; error: string }
> {
  await new Promise((resolve) => setTimeout(resolve, 1600));
  // Real providers fail here often enough that the UI has to have a state for it.
  if (typeof window !== "undefined" && window.location.search.includes("passkey=fail")) {
    return {
      ok: false,
      error:
        "The authenticator was dismissed before it finished. Nothing was created, and you can try again or connect an existing wallet instead.",
    };
  }
  return {
    ok: true,
    account: {
      address: "0x8f2b" + "c4a1d93e77b0125f6a48e0b7c39d5182ea6",
      label: "Passkey on this device",
      createdAt: new Date().toISOString(),
    },
  };
}

export const PASSKEY_COPY = {
  title: "Create a passkey",
  why: "Your key never leaves your device. We can't move your funds and neither can the agent.",
  detail:
    "Touch ID, Face ID or a security key. An embedded wallet is provisioned behind it, so there is no seed phrase to write down and no extension to install.",
};

export const WALLET_COPY = {
  title: "Connect an existing wallet",
  why: "Already have a wallet you sign with? Use it. The plan is signed the same way either way.",
};
