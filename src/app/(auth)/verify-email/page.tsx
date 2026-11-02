import { Suspense } from "react";
import { VerifyEmail } from "./verify-email";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
