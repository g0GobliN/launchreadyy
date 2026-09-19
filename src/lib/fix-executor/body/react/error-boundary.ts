export const ERROR_BOUNDARY_TSX = `'use client'

import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Something went wrong</h2>
      <p>Please try again or contact support if the problem persists.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </div>
  )
}
`;
