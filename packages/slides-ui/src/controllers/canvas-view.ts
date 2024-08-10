/**
 * Copyright 2023-present DreamNum Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { EventState, IColorStyle, IPageElement, ISlidePage, Nullable, SlideDataModel, UnitModel } from '@univerjs/core';
import { debounce, getColorStyle, Inject, Injector, IUniverInstanceService, LifecycleStages, OnLifecycle, RxDisposable, UniverInstanceType } from '@univerjs/core';
import type { BaseObject, IRender, IRenderContext, IRenderModule, IWheelEvent,
    Scene } from '@univerjs/engine-render';
import {
    IRenderManagerService,
    Rect,
    ScrollBar,
    Slide,
    Viewport,
} from '@univerjs/engine-render';

import { Subject, takeUntil } from 'rxjs';
// import { ObjectProvider } from '@univerjs/slides';
import { SlideRenderController } from './slide.render-controller';

export enum SLIDE_KEY {
    COMPONENT = '__slideRender__',
    SCENE = '__mainScene__',
    VIEW = '__mainView__',
}

export type PageID = string;

// export const ICanvasView = createIdentifier<IUniverInstanceService>('univer.slide.canvas-view');
@OnLifecycle(LifecycleStages.Ready, CanvasView)
export class CanvasView extends RxDisposable implements IRenderModule {
    // private _objectProvider: ObjectProvider | null = null;

    constructor(
        // this controller needs by commands. that means this controller is  not init by renderUnit, no renderContext.
        // private readonly _renderContext: IRenderContext<UnitModel>,
        @Inject(Injector) private readonly _injector: Injector,
        @IUniverInstanceService private readonly _instanceSrv: IUniverInstanceService,
        @IRenderManagerService private readonly _renderManagerService: IRenderManagerService
    ) {
        super();
        this._initialize();
    }

    get objectProvider() {
        return null;
        //return this._objectProvider;
    }

    private _scene: Scene | null = null;

    get Scene() {
        return this._scene;
    }

    private _viewport: Viewport | null = null;

    get Viewport() {
        return this._viewport;
    }

    private _slide: Slide | null = null;

    get Slide() {
        return this._slide;
    }

    private _scrollBar: ScrollBar | null = null;

    get ScrollBar() {
        return this._scrollBar;
    }

    private _initialize() {
        //...
    }

    private _scrollToCenter() {
        const mainScene = this._currentRenderUnit()?.scene;
        const viewMain = mainScene?.getViewport(SLIDE_KEY.VIEW);
        const getCenterPositionViewPort = this._getCenterPositionViewPort(mainScene);
        if (!viewMain || !getCenterPositionViewPort) return;
        const { left: viewPortLeft, top: viewPortTop } = getCenterPositionViewPort;

        const { x, y } = viewMain.transViewportScroll2ScrollValue(viewPortLeft, viewPortTop);

        viewMain.scrollToBarPos({
            x,
            y,
        });
    }

    /**
     * current RenderUnit by UnitId
     * @returns IRender
     */
    private _currentRenderUnit(): Nullable<IRender> {
        // const slideDataModel = this._instanceSrv.getCurrentUnitForType<SlideDataModel>(UniverInstanceType.UNIVER_SLIDE)!;
        // return this._renderManagerService.getRenderById(slideDataModel.getUnitId());

        return this._renderManagerService
            .getRenderById(this._instanceSrv.getCurrentUnitForType(UniverInstanceType.UNIVER_SLIDE)!.getUnitId())!;
    }

    /**
     * _initialize --> _create --> _addNewRender
     * @param unitId
     */

    private _addNewRender(unitId: string) {
        const slideDataModel = this._instanceSrv.getUnit<SlideDataModel>(unitId, UniverInstanceType.UNIVER_SLIDE);

        if (!slideDataModel) return;

        this._renderManagerService.createRender(unitId);
        const currentRender = this._renderManagerService.getRenderById(unitId);
        if (!currentRender) return;

        //#region scene subscribe
        const { engine, scene } = currentRender;
        const observer = engine.onTransformChange$.subscribeEvent(() => {
            this._scrollToCenter();
            // add once
            observer?.unsubscribe();
        });
        engine.onTransformChange$.subscribeEvent(() => {
            setTimeout(() => {
                this.createThumbs();
            }, 300);
        });
        scene.attachControl();
        scene.onMouseWheel$.subscribeEvent((evt: unknown, state: EventState) => {
            const e = evt as IWheelEvent;
            if (e.ctrlKey) {
                const deltaFactor = Math.abs(e.deltaX);
                let scrollNum = deltaFactor < 40 ? 0.2 : deltaFactor < 80 ? 0.4 : 0.2;
                scrollNum *= e.deltaY > 0 ? -1 : 1;
                if (scene.scaleX < 1) {
                    scrollNum /= 2;
                }

                if (scene.scaleX + scrollNum > 4) {
                    scene.scale(4, 4);
                } else if (scene.scaleX + scrollNum < 0.1) {
                    scene.scale(0.1, 0.1);
                } else {
                    const value = e.deltaY > 0 ? 0.1 : -0.1;
                    // scene.scaleBy(scrollNum, scrollNum);
                    e.preventDefault();
                }
            } else {
                viewMain.onMouseWheel(e, state);
            }
        });
        scene.onFileLoaded$.subscribeEvent(() => {
            this._refreshThumb();
        });
        //#endregion

        const viewMain = new Viewport(SLIDE_KEY.VIEW, scene, {
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            isRelativeX: true,
            isRelativeY: true,
            isWheelPreventDefaultX: true,
        });
        ScrollBar.attachTo(viewMain);
        this._renderManagerService.setCurrent(unitId);

        // #region create slide
        const slideComponent = this._createSlide(scene);
        currentRender.mainComponent = slideComponent;
        currentRender.components.set(SLIDE_KEY.COMPONENT, slideComponent);
        this._createSlidePages(slideDataModel, slideComponent);
        this.createThumbs();
        // #endregion

        engine.runRenderLoop(() => {
            scene.render();
        });
    }

    private _refreshThumb = debounce(() => {
        this.createThumbs();
    }, 300);

    private _createSlide(mainScene: Scene) {
        const model = this._instanceSrv.getCurrentUnitForType<SlideDataModel>(UniverInstanceType.UNIVER_SLIDE)!;

        const { width: sceneWidth, height: sceneHeight } = mainScene;

        const pageSize = model.getPageSize();

        const { width = 100, height = 100 } = pageSize;

        const slideComponent = new Slide(SLIDE_KEY.COMPONENT, {
            left: (sceneWidth - width) / 2,
            top: (sceneHeight - height) / 2,
            width,
            height,
            zIndex: 10,
        });

        // slideComponent.enableNav();

        slideComponent.enableSelectedClipElement();

        mainScene.addObject(slideComponent);

        return slideComponent;
    }

    private _addBackgroundRect(scene: Scene, fill: IColorStyle) {
        const model = this._instanceSrv.getCurrentUnitForType<SlideDataModel>(UniverInstanceType.UNIVER_SLIDE)!;

        const pageSize = model.getPageSize();

        const { width: pageWidth = 0, height: pageHeight = 0 } = pageSize;

        const page = new Rect('canvas', {
            left: 0,
            top: 0,
            width: pageWidth,
            height: pageHeight,
            strokeWidth: 1,
            stroke: 'rgba(198,198,198,1)',
            fill: getColorStyle(fill) || 'rgba(255,255,255,1)',
            zIndex: 0,
            evented: false,
        });
        scene.addObject(page, 0);
    }

    private _getCenterPositionViewPort(mainScene?: Scene) {
        if (!mainScene) return { left: 0, top: 0 };
        const { width, height } = mainScene;

        const engine = mainScene.getEngine();

        const canvasWidth = engine?.width || 0;
        const canvasHeight = engine?.height || 0;

        return {
            left: (width - canvasWidth) / 2,
            top: (height - canvasHeight) / 2,
        };
    }

    private _thumbSceneRender(pageId: string, slide: Slide) {
        const render = this._renderManagerService.getRenderById(pageId);

        if (render == null) {
            return;
        }

        const { engine: thumbEngine } = render;

        if (thumbEngine == null) {
            return;
        }

        const { width, height } = slide;

        const { width: pageWidth = width, height: pageHeight = height } = thumbEngine;

        const thumbContext = thumbEngine.getCanvas().getContext();

        slide.renderToThumb(thumbContext, pageId, pageWidth / width, pageHeight / height);
    }

    private _sceneMap = new Map<string, Scene>();
    setSceneMap$ = new Subject<Scene>();

    createThumbs() {
        const slideDataModel = this._instanceSrv.getCurrentUnitForType<SlideDataModel>(UniverInstanceType.UNIVER_SLIDE)!;

        const pageOrder = slideDataModel.getPageOrder();

        const render = this._currentRenderUnit();

        if (!pageOrder || !render) {
            return;
        }

        if (pageOrder.length === 0) {
            return;
        }

        for (let i = 0, len = pageOrder.length; i < len; i++) {
            const pageId = pageOrder[i];

            this._thumbSceneRender(pageId, render.mainComponent as Slide);
        }
    }

    activePage(_pageId?: string) {
        let pageId = _pageId;
        const model = this._instanceSrv.getCurrentUnitForType<SlideDataModel>(UniverInstanceType.UNIVER_SLIDE)!;
        let page: Nullable<ISlidePage>;
        if (pageId) {
            page = model.getPage(pageId);
        } else {
            const pageElements = model.getPages();
            const pageOrder = model.getPageOrder();
            if (pageOrder == null || pageElements == null) {
                return;
            }
            page = pageElements[pageOrder[0]];

            pageId = page.id;
        }

        const render = this._currentRenderUnit();

        if (page == null || render == null || render.mainComponent == null) {
            return;
        }

        const { id } = page;

        const slide = render.mainComponent as Slide;

        model.setActivePage(page);

        if (slide?.hasPage(id)) {
            slide.changePage(id);
        } else {
            // const canvasView = accessor.get(CanvasView);
            // this._createPageScene(id, page);
            const slideRC = this.getSlideRenderControllerFromRenderUnit();
            slideRC.createPageScene(id, page);
        }
    }

    getSlideRenderControllerFromRenderUnit() {
        const renderUnit = this._renderManagerService
            .getRenderById(this._instanceSrv.getCurrentUnitForType(UniverInstanceType.UNIVER_SLIDE)!.getUnitId())!;
        const slideRC = renderUnit.with(SlideRenderController);
        return slideRC;
    }

    getRenderUnitByPageId(pageId: PageID) {
        const renderUnit = this._currentRenderUnit();
        if (!renderUnit) return { scene: null };
        // const sceneMap = renderUnit._renderContext.sceneMap;
        const pageScene: Scene = renderUnit.components.get(pageId) as unknown as Scene;

        return {
            scene: pageScene,
        };
    }

    createObjectToPage(element: IPageElement, pageID: PageID): Nullable<BaseObject> {
        const slideRC = this.getSlideRenderControllerFromRenderUnit();
        slideRC.createObjectToPage(element, pageID);
    }

    setObjectActiveByPage(obj: BaseObject, pageID: PageID) {
        const { scene } = this.getRenderUnitByPageId(pageID);
        // console.log(obj);
        if (!scene) return;
        const transformer = scene.getTransformer();
        transformer?.activeAnObject(obj);
    }

    removeObjectById(id: string, pageID: PageID) {
        const { scene } = this.getRenderUnitByPageId(pageID);
        if (!scene) return;
        scene.removeObject(id);
        const transformer = scene.getTransformer();
        transformer?.clearControls();
    }

    /**
     * append blank page
     */
    appendPage() {
        const slideRC = this.getSlideRenderControllerFromRenderUnit();
        slideRC.appendPage();
    }
}
