// Landing page: "Start coding" points at a brand-new room. Set the href on load
// so it's a real link (middle-click / open-in-new-tab work), and refresh it on
// each click so repeated clicks never reuse the same room id.
const newRoom = (): string => `/room/${crypto.randomUUID()}`;

const start = document.getElementById('start') as HTMLAnchorElement | null;
if (start) {
  start.href = newRoom();
  start.addEventListener('click', () => {
    start.href = newRoom();
  });
}
