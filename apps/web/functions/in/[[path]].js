// 経路リンク（/in/ki-xxxx）と、その先の LINE の中の画面（/in/join）も、画面と同じアドレスで受けて Worker に渡す
export const onRequest = ({ request, env }) => env.API.fetch(request)
