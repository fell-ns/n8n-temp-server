# n8n-temp-server

Servidor temporário de vídeos para automações n8n que precisam entregar um MP4 por URL pública para serviços como Meta/Instagram.

## Variáveis de ambiente

- `INTERNAL_TOKEN`: token secreto usado pelo n8n no header `Authorization: Bearer ...`.
- `BASE_URL`: URL pública do serviço, de preferência HTTPS, sem barra final. Ex.: `https://video.exemplo.com`.
- `PORT`: opcional. Padrão `3000`.
- `HOST`: opcional. Padrão `0.0.0.0`.

## Rotas

- `GET /health` — healthcheck.
- `GET /` — status simples do serviço.
- `POST /upload` — upload protegido, multipart/form-data, campo binário `file`.
- `GET /video/:filename` — arquivo público para a Meta baixar.
- `DELETE /video/:filename` — exclusão protegida por Bearer token.

## Resposta de upload

Exemplo:

```json
{
  "success": true,
  "file_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.mp4",
  "size": 123456,
  "expires_in_seconds": 7200,
  "url": "https://video.exemplo.com/video/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.mp4"
}
```

## EasyPanel

O container escuta internamente na porta `3000`. Configure o domínio/serviço do EasyPanel para encaminhar para a porta `3000`.

Para uso com Meta/Instagram, a `BASE_URL` deve ser publicamente acessível pela internet e preferencialmente HTTPS.

## Segurança

- Não coloque tokens reais no repositório.
- Use um `INTERNAL_TOKEN` forte nas variáveis de ambiente do EasyPanel.
- Os arquivos expiram automaticamente após 2 horas.
- O upload aceita somente 1 arquivo MP4 por requisição, com limite de 500 MB.
