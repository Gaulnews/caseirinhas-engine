# CSV staging import

## Endpoint

`POST /api/imports` accepts `multipart/form-data` with one `file` field containing a CSV up to 2 MiB. It requires `Authorization: Bearer <ADMIN_API_TOKEN>`.

## Accepted headers

Company: `title`, `name`, or `nome`. Phone: `phone`, `phoneUnformatted`, `phoneNumber`, or `telefone`. Neighborhood: `neighborhood` or `bairro`. Header matching is case- and accent-insensitive.

## Guarantees

- Quoted CSV values and line breaks inside quoted values are parsed safely.
- Brazilian numbers are accepted only when they normalize to E.164 `+55` plus 10 or 11 digits.
- Duplicate numbers in the same file and in `leads` are not inserted.
- Numbers present in `opt_outs` are rejected.
- Every input line is retained in `lead_import_rows` with a result and reason.
- Inserted leads are always `pending_review`; this endpoint never creates campaigns, jobs or messages.

## Example

```bash
curl -X POST https://YOUR_APP/api/imports \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -F "file=@dataset.csv;type=text/csv"
```
