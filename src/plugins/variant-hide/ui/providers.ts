import { addNavMenuItem, registerBulkAction} from '@vendure/admin-ui/core';
import {
    deleteProductsBulkAction
} from './product-list/product-list-bulk-actions';

export default [
    registerBulkAction(deleteProductsBulkAction),
    addNavMenuItem({
        id: 'facets',
        label: 'Facets',
        routerLink: ['/catalog', 'facets'],
        requiresPermission: '__disable__'
    },
    'catalog'),
];