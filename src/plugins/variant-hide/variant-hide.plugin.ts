import { EventBus, LanguageCode, PluginCommonModule, ProductEvent, ProductVariantEvent, Type, VendurePlugin } from '@vendure/core';
import { VariantHideService } from './services/variant-hide.service';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { loggerCtx } from './constants';
import { AdminUiExtension } from '@vendure/ui-devkit/compiler';
import * as path from 'path';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        weightInKg: number;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [VariantHideService],
    configuration: config => {
        config.customFields.Product.push({
            name: 'weightInKg',
            type: 'float',
            label: [
                { 
                    languageCode: LanguageCode.en, value: 'Weight (kg)'
                },
            ],
        });
        return config;
    },
    compatibility: '^3.0.0',
})
export class VariantHidePlugin implements OnApplicationBootstrap {
    constructor(
        private variantHideService: VariantHideService,
        private eventBus: EventBus,
    ) {}

    onApplicationBootstrap() {
        this.eventBus.ofType(ProductVariantEvent).subscribe(event => {
            if (event.type === 'created') {
                Logger.log(`ProductVariantEvent of type ${event.type} received`, loggerCtx);
                const variantIDs = event.entity.map(variant => variant.id);
                this.variantHideService.updateVariant(event.ctx, variantIDs);
            }
        });

        this.eventBus.ofType(ProductEvent).subscribe(event => {
            if (event.type === 'deleted') {
                Logger.log(`ProductEvent of type ${event.type} received`, loggerCtx);
                this.variantHideService.addToDeletedProductOrderQueue(event.ctx, event.entity.id);
            }
        });
    }

    static ui: AdminUiExtension = {
        id: 'variant-hide-ui',
        extensionPath: path.join(__dirname, 'ui'),
        providers: ['providers.ts'],
        routes: [
            {
                prefix: '',
                route: 'catalog',
                filePath: 'routes.ts',
            },
        ],
    };
    
}
