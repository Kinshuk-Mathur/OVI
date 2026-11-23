"use client";
import { FlowerMark } from "./ovi-logo";
import { useVault } from "@/components/auth/vault-provider";
export function Greeting() {
  const { session } = useVault();
  const name = session.user.displayName?.trim().split(/\s+/)[0];
  return <div className="greeting"><FlowerMark className="greeting-flower" /><h1>Good evening{name ? <>, <span className="greeting-name">{name}.</span></> : "."}</h1></div>;
}
