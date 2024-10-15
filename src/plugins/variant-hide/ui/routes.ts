import { registerRouteComponent } from '@vendure/admin-ui/core';
import { ProductListComponent } from './product-list/product-list.component';

export default [
    registerRouteComponent({
        component: ProductListComponent,
        path: 'products',
        title: 'Products',
        breadcrumb: 'Products',
    }),
];
