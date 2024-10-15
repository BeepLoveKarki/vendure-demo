import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkAction,
    DataService,
    DeletionResult,
    DuplicateEntityDialogComponent,
    GetProductListQuery,
    ItemOf,
    ModalService,
    NotificationService,
    Permission,
} from '@vendure/admin-ui/core';
import { unique } from '@vendure/common/lib/unique';
import { EMPTY } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { ProductListComponent } from './product-list.component';
import { TO_BE_EMPTY_COLLECTIONS_QUERY } from './product-list.graphql';
import { ToBeEmptyCollectionsQueryQuery, ToBeEmptyCollectionsQueryQueryVariables } from '../generated-types';

export const deleteProductsBulkAction: BulkAction<
    ItemOf<GetProductListQuery, 'products'>,
    ProductListComponent
> = {
    location: 'product-list',
    label: _('common.delete'),
    icon: 'trash',
    iconClass: 'is-danger',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteProduct) ||
        userPermissions.includes(Permission.DeleteCatalog),
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);
        
        const emptyCollections$ = dataService.query<
            ToBeEmptyCollectionsQueryQuery,
            ToBeEmptyCollectionsQueryQueryVariables
        >(TO_BE_EMPTY_COLLECTIONS_QUERY, { productIDs: selection.map(p => p.id) }).
        mapStream(data => data.toBeEmptyCollections);

        emptyCollections$.subscribe(emptyCollections => {
            let title: string = _('catalog.confirm-bulk-delete-products');
            if(emptyCollections?.length) {
                title = _('catalog.confirm-bulk-delete-products-warning');
            }
            modalService
            .dialog({
                title: title,
                translationVars: {
                    categories: emptyCollections ? emptyCollections?.map(c => c.name).join(' and ') : '',
                    count: selection.length,
                },
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(response =>
                    response ? dataService.product.deleteProducts(unique(selection.map(p => p.id))) : EMPTY,
                ),
            )
            .subscribe(result => {
                let deleted = 0;
                const errors: string[] = [];
                for (const item of result.deleteProducts) {
                    if (item.result === DeletionResult.DELETED) {
                        deleted++;
                    } else if (item.message) {
                        errors.push(item.message);
                    }
                }
                if (0 < deleted) {
                    notificationService.success(_('catalog.notify-bulk-delete-products-success'), {
                        count: deleted,
                    });
                }
                if (0 < errors.length) {
                    notificationService.error(errors.join('\n'));
                }
                hostComponent.refresh();
                clearSelection();
            });
        });
    },
};