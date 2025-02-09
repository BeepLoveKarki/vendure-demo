import { compileUiExtensions } from '@vendure/ui-devkit/compiler';
import path from 'path';
import { VariantHidePlugin } from '../plugins/variant-hide/variant-hide.plugin';

if (require.main === module) {
    customAdminUi({ recompile: true, devMode: false })
        .compile?.()
        .then(() => {
            process.exit(0);
        });
}

export function customAdminUi(options: { recompile: boolean; devMode: boolean }) {
    if (options.recompile) {
        return compileUiExtensions({
            outputPath: path.join(__dirname, 'admin-ui'),
            extensions: [
                VariantHidePlugin.ui,
                {
                    translations: {
                        en: path.join(__dirname, 'translations/en.json'),
                    },
                    globalStyles: [path.join(__dirname, 'styles/global.scss')],
                }
            ],
            
            devMode: options.devMode,
        });
    } else {
        return {
            path: process.env.ADMIN_UI_PATH || path.join(__dirname, './admin-ui/dist'),
        };
    }
}
