import { watchEffect, type Ref } from 'vue';
import type { TableView } from '../domain/tableView';

/** Camera motion only writes transforms; it never renders the card fields. */
export function useTableCameraLayer(
  stage: Ref<HTMLElement | undefined>, viewport: Ref<HTMLElement | undefined>, scene: Ref<HTMLElement | undefined>,
  view: Readonly<Ref<TableView>>, look: Readonly<Ref<{ lean: number }>>,
): void {
  watchEffect(() => {
    const camera = view.value;
    if (scene.value) scene.value.style.transform = camera.transform;
    if (viewport.value) {
      viewport.value.style.perspective = camera.perspective + 'px';
      viewport.value.style.perspectiveOrigin = camera.centerX + 'px 50%';
    }
    if (!stage.value) return;
    stage.value.dataset.lean = String(look.value.lean);
  }, { flush: 'post' });
}
