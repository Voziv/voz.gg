/// <reference types="astro/client" />
import type { Auth } from './lib/auth';

type AuthSession = Auth['$Infer']['Session'];

declare global {
  namespace App {
    interface Locals {
      user: AuthSession['user'] | null;
      session: AuthSession['session'] | null;
    }
  }
}
