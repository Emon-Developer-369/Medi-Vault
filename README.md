# Medi Vault

The official application source code is in **[`Medi_vault_Emon/`](Medi_vault_Emon/)**.

This repository contains the Flask/Python application, its templates, static assets, tests, and deployment configuration.

## Run locally

```bash
cd Medi_vault_Emon
./run.sh
```

Then open http://127.0.0.1:5001.

## Deployment

The root-level `render.yaml` is the Render Blueprint configuration. It points to `Medi_vault_Emon` as the application root.

## Security

Use synthetic patient data only. Never commit `.env`, database files, uploaded documents, or OAuth secrets. This student project is not intended for real medical records without a full security and privacy review.
