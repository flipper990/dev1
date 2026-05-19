# Next Step Recommendation

1. Keep this TypeScript contract fix as-is (no rollback): it removed the original `generated_typescript_error` baseline blocker.
2. Open a separate, scoped follow-up for `dependency_failure` at `strict-react-next-bundle-pins` during slice merge (`slice-4/7`), without changing preview observability.
3. Add one focused regression test in package-manifest/merge path that reproduces the exact invalid package.json shape seen in `projectId=QRAmPAcgGUzv`.
4. After dependency fix, rerun the same 3 prompts once to confirm 3/3 without expanding prompt count.
