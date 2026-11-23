"use client";
import { useVault } from "@/components/auth/vault-provider";
export function UserAvatar() {
  const { session } = useVault();
  const name = session.user.displayName?.trim() || "OVI user";
  return <div className="user-avatar" aria-label={`${name}'s profile`}>{name.charAt(0).toLocaleUpperCase()}</div>;
}
