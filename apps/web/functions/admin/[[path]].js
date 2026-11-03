// 管理画面と同じアドレスで API を受け、裏で Worker（line-harness）に渡す。
// 画面と API が同じアドレスになるので、Safari もログインの記録（クッキー）を受け取る。
// Worker とは Pages のサービスバインディング「API」でつなぐ（URL で呼ぶと同じアカウント内は 1042 で弾かれる）。
export const onRequest = ({ request, env }) => env.API.fetch(request)
