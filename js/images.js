// images.js — читання завантажених користувачем зображень (розкладка
// панелей, візуалізація об'єкта) як data URL для вбудовування у КП.
(function () {
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function readAll(fileList) {
    const files = Array.from(fileList || []);
    return Promise.all(files.map((f) => readAsDataUrl(f).then((url) => ({ name: f.name, url }))));
  }
  window.KpImages = { readAsDataUrl, readAll };
})();
