// หาชื่อบัญชีและ repo จาก URL ของ GitHub Pages (https://<user>.github.io/<repo>/)
// แล้วเติมลิงก์ไป GitHub / Colab ให้อัตโนมัติ ไม่ต้องแก้ไฟล์ HTML เอง
(function () {
  const host = location.hostname;
  let user = "YOUR_GITHUB_USERNAME", repo = "aiot-classroom";
  if (host.endsWith(".github.io")) {
    user = host.split(".")[0];
    const first = location.pathname.split("/").filter(Boolean)[0];
    if (first && !first.endsWith(".html")) repo = first;
  }
  const gh = `https://github.com/${user}/${repo}`;
  const links = {
    repo: gh,
    firmware: `${gh}/tree/main/firmware`,
    notebook: `${gh}/blob/main/ai/train_comfort_model.ipynb`,
    colab: `https://colab.research.google.com/github/${user}/${repo}/blob/main/ai/train_comfort_model.ipynb`,
  };
  document.querySelectorAll("[data-link]").forEach((a) => {
    const url = links[a.dataset.link];
    if (url) a.href = url;
  });
  window.AIOT_LINKS = links;
})();
