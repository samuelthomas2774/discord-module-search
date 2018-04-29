const util = require('util');
const beautify = require('js-beautify').js_beautify;
const fs = require('fs');
const path = require('path');

const promisify = (f, ...bind) => (...args) => new Promise((resolve, reject) => {
    if (!bind.length) bind.push(f);
    f.call(...bind, ...args, (err, r) => {
        if (err) reject(err);
        else resolve(r);
    });
});

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

module.exports = (Plugin, PluginApi, { $, Vue }) => {
    const { DiscordApi, BdMenuItems, Modals, WebpackModules, CssUtils, Filters, Utils, Settings, CommonComponents, Api } = PluginApi;

    const hljs = WebpackModules.getModuleByName('hljs', Filters.byProperties(['highlight', 'highlightBlock']));

    const components = module.exports.components(Vue, hljs, $, PluginApi, CommonComponents);
    const { Settings: SettingsComponent, ModuleModal } = components;

    return class ModuleSearch extends Plugin {
        async onstart() {
            const scss = await readFile(path.join(__dirname, 'index.scss'), 'utf-8');
            await CssUtils.injectSass(scss);

            this.moduleFilter = this.moduleFilter.bind(this);

            this.menuItem = BdMenuItems.addVueComponent('Developer Tools', this.name, SettingsComponent);

            this.filterSettingsSet = Settings.createSet({text: 'Module Filter', headertext: 'Filters'});
            this.filterSettingsSet.on('settings-updated', async event => {
                if (event.data && event.data.dont_save) return;
                await writeFile(path.join(__dirname, 'filter-settings.json'), JSON.stringify(this.filterSettingsSet.strip()));
                this.filterSettingsSet.setSaved();
            });

            const category = await this.filterSettingsSet.addCategory({id: 'default'});

            await category.addSetting({
                id: 'require-loaded',
                type: 'dropdown',
                text: 'Loaded',
                hint: 'Only show modules that have/haven\'t been loaded.',
                value: 'ignore',
                options: [
                    { id: 'ignore', value: undefined, text: 'Ignore' },
                    { id: 'not-loaded', value: false, text: 'Require unloaded' },
                    { id: 'is-loaded', value: true, text: 'Require loaded' }
                ]
            });
            await category.addSetting({
                id: 'require-name',
                type: 'dropdown',
                text: 'Require name',
                hint: 'Only show modules that have/don\'t have a name.',
                value: 'has-name',
                options: [
                    { id: 'ignore', value: undefined, text: 'Ignore name' },
                    { id: 'no-name', value: false, text: 'Require no name' },
                    { id: 'has-name', value: true, text: 'Require name' }
                ]
            });
            await category.addSetting({
                id: 'name-search',
                type: 'text',
                text: 'Name',
                hint: 'A regular expression to filter modules by their name in.'
            });
            await category.addSetting({
                id: 'code-search',
                type: 'text',
                text: 'Code'
            });
            await category.addSetting({
                id: 'properties',
                type: 'array',
                text: 'Properties',
                inline: true,
                settings: [{id: 'default', settings: [{
                    id: 'property',
                    type: 'text'
                }]}]
            });
            await category.addSetting({
                id: 'prototypes',
                type: 'array',
                text: 'Prototype fields',
                inline: true,
                settings: [{id: 'default', settings: [{
                    id: 'property',
                    type: 'text'
                }]}]
            });
            await category.addSetting({
                id: 'react-component',
                type: 'dropdown',
                text: 'React component',
                hint: 'Only show modules that are/aren\'t a React component.',
                value: 'ignore',
                options: [
                    { id: 'ignore', value: undefined, text: 'Ignore parent class' },
                    { id: 'not-component', value: false, text: 'Require not extends React.Component' },
                    { id: 'is-component', value: true, text: 'Require extends React.Component' }
                ]
            });

            try {
                const settings = await readFile(path.join(__dirname, 'filter-settings.json'));
                await this.filterSettingsSet.merge(JSON.parse(settings), {dont_save: true});
                this.filterSettingsSet.setSaved();
            } catch (err) {}
        }

        onstop() {
            if (this.openKeybind) this.openKeybind.off('keybind-activated', this.openKeybindHandler);
            BdMenuItems.removeAll();
        }

        showModuleDetail(id) {
            return Modals.add({
                Modal: Modals.baseComponent,
                module: Object.defineProperty({}, 'c', {
                    value: WebpackModules.require.c[id]
                }),
                f: WebpackModules.require.m[id],
                module_id: id
            }, ModuleModal);
        }

        moduleFilter(m) {
            const set = this.filterSettingsSet;
            const req = WebpackModules.require;

            if (set.get('default', 'require-name') === true && !m.name) return false;
            if (set.get('default', 'require-name') === false && m.name) return false;

            if (set.get('default', 'require-loaded') === true && !req.c[m.id]) return false;
            if (set.get('default', 'require-loaded') === false && req.c[m.id]) return false;

            if (set.get('default', 'react-component') === true && (!req.c[m.id] || !req.c[m.id].exports.prototype || !req.c[m.id].exports.prototype.isReactComponent)) return false;
            if (set.get('default', 'react-component') === false && (!req.c[m.id] || !req.c[m.id].exports.prototype || req.c[m.id].exports.prototype.isReactComponent)) return false;

            if (this.nameSearchRegex && !this.nameSearchRegex.test(m.name)) return false;
            if (this.codeSearchRegex && !this.codeSearchRegex.test(req.m[m.id].toString())) return false;

            const properties = set.getSetting('default', 'properties').items.map(i => i.get('default', 'property'));
            if (properties.length) {
                if (!req.c[m.id]) return false;
                if (!Filters.byProperties(properties)(req.c[m.id].exports.default || req.c[m.id].exports)) return false;
            }

            const prototypes = set.getSetting('default', 'prototypes').items.map(i => i.get('default', 'property'));
            if (prototypes.length) {
                if (!req.c[m.id]) return false;
                if (!Filters.byPrototypeFields(prototypes)(req.c[m.id].exports.default || req.c[m.id].exports)) return false;
            }

            return true;
        }

        get nameSearchRegex() {
            const nameSearchString = Api.plugin.filterSettingsSet.get('default', 'name-search');
            if (this._nameSearchString === nameSearchString) return this._nameSearchRegex;
            else if (nameSearchString) return this._nameSearchRegex = new RegExp(this._nameSearchString = nameSearchString, 'i');
        }
        get codeSearchRegex() {
            const codeSearchString = Api.plugin.filterSettingsSet.get('default', 'code-search');
            if (this._codeSearchString === codeSearchString) return this._codeSearchRegex;
            else if (codeSearchString) return this._codeSearchRegex = new RegExp(this._codeSearchString = codeSearchString, 'i');
        }

        get api() {
            return Api;
        }
    }
};

module.exports.components = (Vue, hljs, $, { Api, Utils, WebpackModules, Filters }, { Button }) => {
    const components = {};

    const SyntaxHighlighting = components.SyntaxHighlighting = Vue.extend({
        props: ['code', 'language'],
        computed: {
            hightlightedCode() {
                if (!this.language || this.language instanceof Array) return hljs.highlightAuto(this.code, this.language).value;
                else return hljs.highlight(this.language, this.code, true).value;
            }
        },
        template: `<pre class="bd-pre-wrap"><div class="bd-pre" ref="code" v-html="hightlightedCode"></div></pre>`
    });

    const Module = components.Module = Vue.extend({
        components: {
            SyntaxHighlighting
        },
        props: ['id', 'module', 'module-function'],
        data() {
            return {
                beautify
            };
        },
        computed: {
            isLoaded() {
                return this.module.c && this.module.c.l;
            },
            isLoading() {
                return this.module.c && !this.module.c.l;
            },
            moduleName() {
                return (this.module.c && this.module.c.exports.displayName) || this.knownModule || '';
            },
            knownModule() {
                for (let knownModule in WebpackModules.KnownModules) {
                    if (this.matchesFilter(WebpackModules.KnownModules[knownModule]))
                        return knownModule;
                }
            },
            isReactComponent() {
                return this.module.c && ((this.module.c.exports.prototype && this.module.c.exports.prototype.isReactComponent) || (this.module.c.exports.default && this.module.c.exports.default.prototype && this.module.c.exports.default.prototype.isReactComponent));
            }
        },
        methods: {
            matchesFilter(filter) {
                return this.module.c && filter(this.module.c.exports.default || this.module.c.exports);
            }
        },
        mounted() {
            if (!this.$refs.code) return;
            const codecontainer = this.$refs.code.$refs.code;
            for (let el of codecontainer.querySelectorAll('.hljs-number')) {
                if (!el.previousSibling.textContent.match(/(^|[^a-zA-Z0-9_])n\($/)) continue;
                if (!el.nextSibling.textContent.match(/^\)/)) continue;
                el.previousSibling.textContent = el.previousSibling.textContent.substr(0, el.previousSibling.textContent.length - 2);
                el.nextSibling.textContent = el.nextSibling.textContent.substr(1);
                $(el).replaceWith($(`<a class="wms-module-link">n(<span class="hljs-number">${el.innerHTML}</span>)</a>`).click(() => Api.plugin.showModuleDetail(parseInt(el.innerHTML))));
            }
        },
        template: `<div class="wms-module-detail">
            <table><tbody>
                <tr>
                    <td style="width: 10%; min-width: 200px;"><b>Status</b></td>
                    <td class="wms-module-status">{{ isLoaded ? 'Loaded' : isLoading ? 'Loading' : 'Not loaded' }}</td>
                </tr>
                <tr v-if="module.c && module.c.exports.displayName">
                    <td><b>Display Name</b></td>
                    <td>{{ module.c.exports.displayName }}</td>
                </tr>
                <tr v-if="knownModule">
                    <td><b>Known Module Name</b></td>
                    <td>{{ knownModule }}</td>
                </tr>
                <tr v-if="isLoaded">
                    <td><b>React component</b></td>
                    <td>{{ isReactComponent ? 'Yes' : 'No' }}</td>
                </tr>
            </tbody></table>

            <template v-if="module.c">
                <h3 class="bd-form-header">Exports</h3>
                <pre class="bd-pre-wrap"><div class="bd-pre">{{ require('util').inspect(module.c.exports) }}</div></pre>
            </template>

            <template v-if="module.c && module.c.exports.prototype">
                <h3 class="bd-form-header">Prototype</h3>
                <pre class="bd-pre-wrap"><div class="bd-pre">{{ require('util').inspect(module.c.exports.prototype) }}</div></pre>
            </template>

            <h3 class="bd-form-header">Code</h3>
            <SyntaxHighlighting :code="beautify(moduleFunction.toString(), {indent_size: 2})" language="javascript" ref="code" />
        </div>`
    });

    const ModuleModal = components.ModuleModal = Vue.extend({
        components: {
            Module
        },
        props: ['modal'],
        data() {
            return {
                moduleName: undefined
            }
        },
        mounted() {
            this.moduleName = this.$refs.moduleDetail.moduleName;
        },
        template: `<component :is="modal.Modal" class="wms-modal wms-module" :class="{'bd-modal-out': modal.closing}" :headerText="'Module #' + modal.module_id + (moduleName ? ': ' + moduleName : '')" @close="modal.close">
            <Module slot="body" ref="moduleDetail" class="wms-modal-body" :id="modal.module_id" :module="modal.module" :module-function="modal.f" />
        </component>`
    });

    const Modules = components.Modules = Vue.extend({
        props: ['require', 'show-loading', 'filter'],
        data() {
            return {
                modules: [],
                visibleModules: [],
                loading: false,
                loaded: 0,
                total: 0,
                updatingFilter: false
            };
        },
        methods: {
            matchesFilter(id, filter) {
                return this.require.c[id] && filter(this.require.c[id].exports.default || this.require.c[id].exports);
            },
            isKnownModule(id) {
                for (let knownModule in WebpackModules.KnownModules) {
                    if (this.matchesFilter(id, WebpackModules.KnownModules[knownModule]))
                        return knownModule;
                }
            },
            showModuleDetail(id) {
                Api.plugin.showModuleDetail(id);
            },
            async updateFilters() {
                const loading = this.loading;
                if (this.loading) {
                    this.loading = false;
                }
                if (this.updatingFilter) {
                    this.updatingFilter = undefined;
                    await Utils.until(() => this.updatingFilter === false);
                }
                this.updatingFilter = true;
                const loaded = this.loaded;
                this.loaded = 0;
                for (let module of this.modules) {
                    if (!this.updatingFilter) break;
                    if ((module.id % 25) === 0) await Utils.wait(10);
                    module.show = this.filter(module);
                    this.visibleModules.splice(module.id, 1, module.show ? module : undefined);
                    this.loaded++;
                }
                this.loaded = loaded;
                this.updatingFilter = false;
                this.loading = loading;
            },
            onSettingsUpdated() {
                const filterSettingsSet = Api.plugin.filterSettingsSet;
                this.updateFilters();
            }
        },
        watch: {
            loading(loading) {
                this.$emit('update-loading', loading);
            },
            loaded(loaded) {
                this.$emit('update-loaded', loaded);
            },
            total(total) {
                this.$emit('update-total', total);
            },
            updatingFilter(updatingFilter) {
                this.$emit('updating-filters', updatingFilter);
            },
            filter(filter) {
                this.updateFilters();
            }
        },
        async mounted() {
            this.loading = true;
            this.total = this.require.m.length;
            for (let id in this.require.m) {
                if (!this.loading) await Utils.until(() => this.loading);
                if ((id % 25) === 0) await Utils.wait(5);
                let m = {
                    id,
                    name: (this.require.c[id] && this.require.c[id].exports.displayName) || this.isKnownModule(id) || '',
                    status: this.require.c[id] ? this.require.c[id].l ? 'Loaded' : 'Loading' : 'Not loaded'
                };
                m.show = this.filter(m);
                this.modules.push(m);
                this.visibleModules.push(m.show ? m : undefined);
                this.loaded++;
            }
            this.loading = false;
            Api.plugin.filterSettingsSet.on('settings-updated', this.onSettingsUpdated);
        },
        unmounted() {
            this.loading = false;
            this.updatingFilter = false;
            Api.plugin.filterSettingsSet.off('settings-updated', this.onSettingsUpdated);
        },
        template: `<div class="wms-modules-wrap">
            <p v-if="updatingFilter && showLoading">Updating filters...</p>
            <p v-if="loading && showLoading">Loading {{ loaded }}/{{ total }}...</p>

            <div class="wms-modules-table" ref="table">
                <div class="wms-module-row" v-for="(module, id) in visibleModules.filter(m => m)" v-if="module" @click="showModuleDetail(module.id)">
                    <h3 class="wms-module-header">
                        <span class="wms-module-id">{{ module.id }}</span>
                        <span class="wms-module-name">{{ module.name }}</span>
                        <span class="wms-module-react-component" v-if="require.c[module.id] && require.c[module.id].exports.prototype && require.c[module.id].exports.prototype.isReactComponent">React</span>
                        <span class="wms-module-status">{{ module.status }}</span>
                    </h3>
                </div>
            </div>
        </div>`
    });

    const Settings = components.Settings = Vue.extend({
        components: {
            Modules,
            Button
        },
        props: ['SettingsWrapper'],
        data() {
            return {
                Api,
                plugin: Api.plugin,
                loading: false,
                updatingFilters: false,
                loaded: 0,
                total: 0
            };
        },
        template: `<component :is="SettingsWrapper" :headertext="plugin.name">
            <div class="wms-tools" slot="header">
                <span v-if="loading || updatingFilters">Searching {{ Math.floor((loaded / total) * 100) }}%...</span>
                <Button @click="plugin.filterSettingsSet.showModal()">Filters</Button>
            </div>

            <Modules :require="Api.WebpackModules.require" :filter="plugin.moduleFilter"
                @update-loading="l => loading = l" @update-loaded="l => loaded = l"
                @update-total="t => total = t" @updating-filters="f => updatingFilters = f" />
        </component>`
    });

    return components;
}
